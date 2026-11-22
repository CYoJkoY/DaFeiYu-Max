/** Platform-neutral descriptions of the social adapter contract. */

export type SocialPlatformId = 'bilibili' | 'douyin' | 'xiaoheihe' | 'tieba';

export type SocialItemKind = 'video' | 'thread' | 'post' | 'message';

export interface SocialItem {
  id: string;
  platform: SocialPlatformId;
  kind: SocialItemKind;
  title: string;
  url?: string;
  author?: string;
  excerpt?: string;
  hot?: number;
  createdAt?: number;
}

export interface ReadContext {
  fetcher: typeof fetch;
  bridgeUrl?: string;
  credentials: Record<string, string>;
  interests: readonly string[];
  now: number;
  timeoutMs: number;
}

export interface ReadResult {
  ok: boolean;
  items: SocialItem[];
  note: string;
  error?: string;
}

export interface WriteRequest {
  target: string;
  text: string;
}

export interface WriteResult {
  ok: boolean;
  note: string;
  error?: string;
}

export interface SocialAdapter {
  id: SocialPlatformId;
  label: string;
  note: string;
  /** Can be read without the user pasting private credentials. */
  reads: boolean;
  /** Can post/send through a write path. Never enabled implicitly. */
  writes: boolean;
  requires: 'none' | 'bridge' | 'credentials';
  read(context: ReadContext): Promise<ReadResult>;
  write?(context: ReadContext, request: WriteRequest): Promise<WriteResult>;
}
