package com.cineflow.processing.consumer;

import com.cineflow.config.KafkaConfig;
import com.cineflow.processing.event.VideoProcessingEvent;
import com.cineflow.processing.service.VideoProcessingService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.support.KafkaHeaders;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.stereotype.Component;

@Slf4j
@Component
@RequiredArgsConstructor
public class VideoProcessingConsumer {

    private final VideoProcessingService videoProcessingService;

    @KafkaListener(
            topics = KafkaConfig.VIDEO_PROCESSING_TOPIC,
            groupId = "cineflow-processing-group",
            concurrency = "2"   // 2 parallel workers
    )
    public void processVideo(
            @Payload VideoProcessingEvent event,
            @Header(KafkaHeaders.RECEIVED_PARTITION) int partition,
            @Header(KafkaHeaders.OFFSET) long offset) {

        log.info("Received processing job — videoId: {}, partition: {}, offset: {}",
                event.getVideoId(), partition, offset);

        videoProcessingService.processVideo(event.getVideoId(), event.getS3RawKey());
    }
}