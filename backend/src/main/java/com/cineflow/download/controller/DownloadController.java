package com.cineflow.download.controller;

import com.cineflow.common.response.ApiResponse;
import com.cineflow.download.dto.DownloadHistoryDto;
import com.cineflow.download.dto.DownloadResponse;
import com.cineflow.download.service.DownloadService;
import com.cineflow.user.entity.User;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/download")
@RequiredArgsConstructor
@Tag(
        name = "Download API",
        description = "Generate secure download links and retrieve download history"
)
public class DownloadController {

    private final DownloadService downloadService;

    @GetMapping("/{videoId}")
    @Operation(summary = "Generate secure download URL")
    public ResponseEntity<ApiResponse<DownloadResponse>> generateDownloadUrl(

            @AuthenticationPrincipal User user,

            @PathVariable UUID videoId,

            @RequestParam(defaultValue = "720p")
            String quality
    ) {

        DownloadResponse response =
                downloadService.generateDownloadUrl(
                        user.getId(),
                        videoId,
                        quality
                );

        return ResponseEntity.ok(
                ApiResponse.success(response)
        );
    }

    @GetMapping("/history")
    @Operation(summary = "Get user download history")
    public ResponseEntity<ApiResponse<List<DownloadHistoryDto>>> getHistory(

            @AuthenticationPrincipal User user
    ) {

        List<DownloadHistoryDto> history =
                downloadService.getUserDownloadHistory(
                        user.getId()
                );

        return ResponseEntity.ok(
                ApiResponse.success(history)
        );
    }

}