import type {
  CreateImageTaskDto,
  ImageHistoryResponse,
  ImageTaskDto,
  OptimizePromptResponse,
  PlatformModelDto,
} from '@lumina/shared';
import { apiClient } from './api-client';

export type ImageTaskResponse = ImageTaskDto & {
  cost: number | string | null;
};

export const imageApi = {
  getModels(): Promise<PlatformModelDto[]> {
    return apiClient.get('/providers/models?type=IMAGE');
  },

  optimizePrompt(prompt: string): Promise<OptimizePromptResponse> {
    return apiClient.post('/image/optimize-prompt', { prompt });
  },

  generate(data: CreateImageTaskDto, referenceImage?: File): Promise<ImageTaskResponse> {
    if (!referenceImage) return apiClient.post('/image/generate', data);

    const form = new FormData();
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) form.append(key, String(value));
    }
    form.append('referenceImage', referenceImage);
    return apiClient.post('/image/generate', form);
  },

  getTask(taskId: string): Promise<ImageTaskResponse> {
    return apiClient.get(`/image/tasks/${taskId}`);
  },

  getHistory(page = 1, limit = 12): Promise<ImageHistoryResponse> {
    return apiClient.get(`/image/history?page=${page}&limit=${limit}`);
  },
};
