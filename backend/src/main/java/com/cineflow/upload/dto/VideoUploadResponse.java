package com.cineflow.upload.dto;

import com.cineflow.video.enums.VideoStatus;
import lombok.Builder;
import lombok.Getter;

import java.util.UUID;

@Getter
@Builder
public class VideoUploadResponse {
    private UUID videoId;
    private String title;
    private VideoStatus status;
    private String message;
}