
/**
 * CineFlow – k6 Load Testing & Performance Simulation
 *
 * Tests:
 *  1. Authentication (registration + login)
 *  2. Video catalogue (cache warm-up + repeated requests)
 *  3. Video metadata retrieval (cached vs uncached latency)
 *  4. HLS streaming startup (master.m3u8 latency / TTFF proxy)
 *  5. Video processing status and metrics endpoints
 *  6. Concurrent user simulation (100 → 500 users)
 *
 * Run:
 *   k6 run load-test.js
 *
 * Custom backend URL:
 *   k6 run -e BASE_URL=http://localhost:8080 load-test.js
 *
 * Test a specific video:
 *   k6 run -e VIDEO_ID=your-video-id load-test.js
 *
 * Install k6:
 *   https://k6.io/docs/getting-started/installation/
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ─────────────────────────────────────────────────────────────────────────────
// Custom Performance Metrics
// ─────────────────────────────────────────────────────────────────────────────

const errorRate = new Rate('cineflow_errors');

const ttffTrend = new Trend(
    'cineflow_ttff_ms',
    true
);

const cachedLatency = new Trend(
    'cineflow_cached_latency_ms',
    true
);

const uncachedLatency = new Trend(
    'cineflow_uncached_latency_ms',
    true
);

const successfulRequests = new Counter(
    'cineflow_successful_requests'
);

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

const KNOWN_VIDEO_ID = __ENV.VIDEO_ID || '';

const TEST_EMAIL = `k6-user-${Date.now()}@cineflow.test`;

const TEST_PASSWORD = 'K6testpass1!';

// ─────────────────────────────────────────────────────────────────────────────
// Load Testing Scenarios
// ─────────────────────────────────────────────────────────────────────────────

export const options = {

    scenarios: {

        // Scenario 1: Baseline load — 100 concurrent users
        baseline: {
            executor: 'ramping-vus',

            startVUs: 0,

            stages: [
                { duration: '30s', target: 10 },
                { duration: '60s', target: 100 },
                { duration: '60s', target: 100 },
                { duration: '15s', target: 0 },
            ],

            gracefulRampDown: '10s',

            exec: 'videoReadWorkload',
        },

        // Scenario 2: Spike testing — 500 concurrent users
        spike: {
            executor: 'ramping-vus',

            startVUs: 0,

            startTime: '3m',

            stages: [
                { duration: '10s', target: 500 },
                { duration: '30s', target: 500 },
                { duration: '10s', target: 0 },
            ],

            gracefulRampDown: '10s',

            exec: 'videoReadWorkload',
        },

        // Scenario 3: HLS streaming startup performance
        streamingStartup: {
            executor: 'constant-vus',

            vus: 20,

            duration: '60s',

            startTime: '1m',

            exec: 'streamingWorkload',
        },
    },

    // Performance thresholds
    thresholds: {

        // API response time
        'http_req_duration{scenario:baseline}': [
            'p(95)<200'
        ],

        // Streaming startup latency
        'cineflow_ttff_ms': [
            'p(95)<2000'
        ],

        // Application error rate
        'cineflow_errors': [
            'rate<0.01'
        ],

        // HTTP request failure rate
        'http_req_failed': [
            'rate<0.01'
        ],
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Shared Configuration
// ─────────────────────────────────────────────────────────────────────────────

let authToken = '';

let videoId = KNOWN_VIDEO_ID;

// ─────────────────────────────────────────────────────────────────────────────
// Setup: Authentication & Test Data Discovery
// ─────────────────────────────────────────────────────────────────────────────

export function setup() {

    console.log('Starting CineFlow load testing...');
    console.log(`Target backend: ${BASE_URL}`);

    const email = TEST_EMAIL;

    const password = TEST_PASSWORD;

    // Register test user
    const regRes = http.post(
        `${BASE_URL}/api/v1/auth/register`,

        JSON.stringify({
            name: 'k6 Test User',
            email,
            password,
        }),

        {
            headers: {
                'Content-Type': 'application/json',
            },
        }
    );

    let token = '';

    if (regRes.status === 200 || regRes.status === 201) {

        token = regRes.json('data.token') || '';

    } else {

        // Attempt login if registration fails
        const loginRes = http.post(
            `${BASE_URL}/api/v1/auth/login`,

            JSON.stringify({
                email,
                password,
            }),

            {
                headers: {
                    'Content-Type': 'application/json',
                },
            }
        );

        if (loginRes.status === 200) {
            token = loginRes.json('data.token') || '';
        }
    }

    // Discover a video ready for streaming
    let vid = KNOWN_VIDEO_ID;

    if (!vid && token) {

        const listRes = http.get(
            `${BASE_URL}/api/v1/videos/by-status?status=READY`,

            {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            }
        );

        if (listRes.status === 200) {

            const videos = listRes.json('data');

            if (videos && videos.length > 0) {
                vid = videos[0].id;
            }
        }
    }

    console.log(`Authentication: ${token ? 'SUCCESS' : 'FAILED'}`);

    console.log(`Video selected: ${vid || 'NONE'}`);

    return {
        token,
        videoId: vid,
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Workload 1: Video Catalogue & Metadata Performance
// ─────────────────────────────────────────────────────────────────────────────

export function videoReadWorkload(data) {

    const headers = {
        Authorization: `Bearer ${data.token}`,
        'Content-Type': 'application/json',
    };

    // Video catalogue requests
    group('Video Catalogue', () => {

        const res = http.get(
            `${BASE_URL}/api/v1/videos`,
            { headers }
        );

        const ok = check(res, {
            'video catalogue returns 200': (r) => r.status === 200,
        });

        errorRate.add(!ok);

        if (ok) successfulRequests.add(1);

        // Repeated request to evaluate cache performance
        const cachedRes = http.get(
            `${BASE_URL}/api/v1/videos`,
            { headers }
        );

        const cachedOk = check(cachedRes, {
            'cached catalogue returns 200': (r) => r.status === 200,
        });

        errorRate.add(!cachedOk);

        if (cachedOk) {
            cachedLatency.add(cachedRes.timings.duration);
            successfulRequests.add(1);
        }
    });

    if (data.videoId) {

        // Video metadata retrieval
        group('Video Metadata', () => {

            // First request
            const firstRes = http.get(
                `${BASE_URL}/api/v1/videos/${data.videoId}`,
                { headers }
            );

            const firstOk = check(firstRes, {
                'video metadata returns 200': (r) => r.status === 200,
            });

            errorRate.add(!firstOk);

            if (firstOk) {
                uncachedLatency.add(firstRes.timings.duration);
                successfulRequests.add(1);
            }

            // Repeated request
            const secondRes = http.get(
                `${BASE_URL}/api/v1/videos/${data.videoId}`,
                { headers }
            );

            const secondOk = check(secondRes, {
                'repeated metadata request returns 200': (r) => r.status === 200,
            });

            errorRate.add(!secondOk);

            if (secondOk) {
                cachedLatency.add(secondRes.timings.duration);
                successfulRequests.add(1);
            }
        });

        // Video processing status
        group('Video Processing Status', () => {

            const res = http.get(
                `${BASE_URL}/api/v1/videos/${data.videoId}/status`,
                { headers }
            );

            const ok = check(res, {
                'video status returns 200': (r) => r.status === 200,
            });

            errorRate.add(!ok);

            if (ok) successfulRequests.add(1);
        });
    }

    // Application metrics endpoint
    group('Application Metrics', () => {

        const res = http.get(
            `${BASE_URL}/api/v1/metrics/summary`,
            { headers }
        );

        const ok = check(res, {
            'metrics summary returns 200': (r) => r.status === 200,
        });

        errorRate.add(!ok);
    });

    // Simulate real user interaction delay
    sleep(Math.random() * 1 + 0.5);
}

// ─────────────────────────────────────────────────────────────────────────────
// Workload 2: HLS Streaming Startup & Playback
// ─────────────────────────────────────────────────────────────────────────────

export function streamingWorkload(data) {

    if (!data.videoId) {
        sleep(1);
        return;
    }

    const headers = {
        Authorization: `Bearer ${data.token}`,
    };

    // HLS master playlist startup
    group('HLS Streaming Startup', () => {

        const start = Date.now();

        const res = http.get(
            `${BASE_URL}/api/v1/stream/${data.videoId}/master.m3u8`,
            { headers }
        );

        const elapsed = Date.now() - start;

        const ok = check(res, {

            'master playlist returns 200':
                (r) => r.status === 200,

            'valid HLS playlist':
                (r) => r.body && r.body.includes('#EXTM3U'),

            'stream startup below 2000ms':
                () => elapsed < 2000,
        });

        ttffTrend.add(elapsed);

        errorRate.add(!ok);

        if (ok) successfulRequests.add(1);
    });

    // Quality-specific playlist retrieval
    group('HLS Quality Playlist', () => {

        const res = http.get(
            `${BASE_URL}/api/v1/stream/${data.videoId}/720p/index.m3u8`,
            { headers }
        );

        const ok = check(res, {
            '720p playlist returns 200': (r) => r.status === 200,
        });

        errorRate.add(!ok);

        if (ok) successfulRequests.add(1);
    });

    // Streaming metadata
    group('Streaming Information', () => {

        const res = http.get(
            `${BASE_URL}/api/v1/stream/${data.videoId}/info`,
            { headers }
        );

        const ok = check(res, {
            'streaming info returns 200': (r) => r.status === 200,
        });

        errorRate.add(!ok);

        if (ok) successfulRequests.add(1);
    });

    // Simulate viewer watch time
    sleep(Math.random() * 2 + 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Teardown: Test Summary
// ─────────────────────────────────────────────────────────────────────────────

export function teardown(data) {

    console.log('');
    console.log('======================================');
    console.log('     CINEFLOW LOAD TEST COMPLETED');
    console.log('======================================');

    console.log(
        `Authentication: ${data.token ? 'SUCCESS' : 'FAILED'}`
    );

    console.log(
        `Video tested: ${data.videoId || 'NONE'}`
    );

    if (!data.videoId) {
        console.log(
            'Upload and process a video until READY before running streaming tests.'
        );
    }

    console.log('======================================');
}
