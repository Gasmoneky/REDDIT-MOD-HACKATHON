export type InitResponse = {
  type: 'init';
  postId: string;
  count: number;
  username: string;
};

export type IncrementResponse = {
  type: 'increment';
  postId: string;
  count: number;
};

export type DecrementResponse = {
  type: 'decrement';
  postId: string;
  count: number;
};

export type AIAnalysisResult = {
  slopScore?: number;
  maliceScore?: number;
  isAI?: boolean;
  confidence?: number;
};

export type BlocklistData = {
  location: string;
  keywords: string[];
  currencies: string[];
  fraudMarkers: string[];
};
