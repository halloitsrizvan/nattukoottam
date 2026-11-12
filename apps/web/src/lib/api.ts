/**
 * Resolves an absolute API base URL for both fetch() and new URL().
 * In the browser, /api uses the current origin so Next.js can proxy requests
 * to the backend, including when the app is opened from another LAN device.
 * Server-side requests use the local backend origin by default.
 */
export function getApiBaseUrl(): string {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || '/api';
  const origin = typeof window !== 'undefined'
    ? window.location.origin
    : 'http://localhost:3000';

  return new URL(apiBase, origin).toString().replace(/\/+$/, '');
}

export function buildApiUrl(
  endpoint: string,
  params?: Record<string, string | number | undefined>,
): string {
  const url = new URL(`${getApiBaseUrl()}/${endpoint.replace(/^\/+/, '')}`);

  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
}

const TOKEN_KEY = 'naatukoottam_access_token';
const REFRESH_KEY = 'naatukoottam_refresh_token';

export function getStoredToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(REFRESH_KEY);
}

export function saveStoredTokens(accessToken: string, refreshToken?: string) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TOKEN_KEY, accessToken);
  if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
}

export function removeStoredTokens() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export function getAuthHeaders(jsonBody = true): HeadersInit {
  const token = getStoredToken();
  const headers: HeadersInit = {};
  if (jsonBody) headers['Content-Type'] = 'application/json';
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function readApiResponse(res: Response, fallbackMessage: string) {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = data?.message;
    throw new Error(
      (Array.isArray(message) ? message.join(', ') : message) ||
      (res.status >= 500
        ? `${fallbackMessage} (HTTP ${res.status}). Check that the backend API is running and reachable.`
        : `${fallbackMessage} (HTTP ${res.status}).`),
    );
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${fallbackMessage}: the backend returned an invalid JSON response.`);
  }
  return data;
}

export interface LoginParams {
  identifier: string; // phone or email
  password: string;
}

export interface RegisterParams {
  fullName: string;
  phone: string;
  email?: string;
  password: string;
  district: string;
  locality: string;
  role?: 'CITIZEN' | 'DEPARTMENT_OFFICIAL';
  preferredLang?: string;
}

export async function loginApi(params: LoginParams) {
  const apiBase = getApiBaseUrl();
  const res = await fetch(`${apiBase}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || 'Login failed. Please check your credentials.');
  }

  if (data.tokens?.accessToken) {
    saveStoredTokens(data.tokens.accessToken, data.tokens.refreshToken);
  }

  return data;
}

export async function registerApi(params: RegisterParams) {
  const apiBase = getApiBaseUrl();
  const res = await fetch(`${apiBase}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || 'Registration failed. Please check your inputs.');
  }

  if (data.tokens?.accessToken) {
    saveStoredTokens(data.tokens.accessToken, data.tokens.refreshToken);
  }

  return data;
}

// Sync Clerk user information with backend and obtain JWT session
export async function syncClerkUserApi(params: {
  clerkId: string;
  email?: string;
  phone?: string;
  fullName: string;
  avatarUrl?: string;
  district: string;
  locality: string;
}) {
  const apiBase = getApiBaseUrl();
  const res = await fetch(`${apiBase}/auth/clerk-sync`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(params),
  });
  const data = await readApiResponse(res, 'Failed to sync Clerk user');
  // Store tokens if provided
  if (data.tokens?.accessToken) {
    saveStoredTokens(data.tokens.accessToken, data.tokens.refreshToken);
  }
  return data;
}

export async function getCurrentUserApi() {
  const token = getStoredToken();
  if (!token) return null;

  try {
    const apiBase = getApiBaseUrl();
    const res = await fetch(`${apiBase}/auth/me`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      if (res.status === 401) {
        removeStoredTokens();
      }
      return null;
    }

    return await res.json();
  } catch (error) {
    console.warn('Failed to verify token with /auth/me:', error);
    return null;
  }
}

export async function updateUserLocationApi(locationData: { locality: string; district: string; wardNumber?: number }) {
  const token = getStoredToken();
  if (!token) return null;

  try {
    const apiBase = getApiBaseUrl();
    const res = await fetch(`${apiBase}/auth/location`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify(locationData),
    });

    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn('Failed to sync location to user account:', err);
    return null;
  }
}

export async function fetchLivePosts(params?: string | { locality?: string; authorId?: string }) {
  try {
    const queryParams: Record<string, string | undefined> = {};
    if (typeof params === 'string') {
      queryParams.locality = params;
    } else if (params) {
      if (params.locality) queryParams.locality = params.locality;
      if (params.authorId) queryParams.authorId = params.authorId;
    }

    const url = buildApiUrl('posts', queryParams);
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to fetch posts');
    const json = await res.json();
    return Array.isArray(json) ? json : json.data || [];
  } catch (error) {
    console.warn('Backend API offline or unreachable, using client state:', error);
    return [];
  }
}

export const fetchPostsApi = fetchLivePosts;

export async function createLivePostApi(postData: any) {
  const apiBase = getApiBaseUrl();
  const res = await fetch(`${apiBase}/posts`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(postData),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.message || 'Failed to submit post to backend');
  }

  return await res.json();
}

export async function transcribeVoiceAudioApi(
  audioBlob: Blob,
  language = 'ml',
  uploadAudio = true
): Promise<{ text: string; audioUrl?: string; warning?: string; error?: string }> {
  try {
    const apiBase = getApiBaseUrl();
    const formData = new FormData();
    const filename = `voice_note_${Date.now()}.${audioBlob.type.includes('mp4') ? 'm4a' : 'webm'}`;
    formData.append('file', audioBlob, filename);
    formData.append('language', language);

    const res = await fetch(`${apiBase}/storage/transcribe?upload=${uploadAudio ? 'true' : 'false'}`, {
      method: 'POST',
      // Let fetch set the multipart content type, including the audio boundary.
      headers: getAuthHeaders(false),
      body: formData,
    });

    return await readApiResponse(res, 'Failed to transcribe audio');
  } catch (error: any) {
    console.warn('Transcription API error:', error);
    return { text: '', error: error.message };
  }
}

export async function fetchLiveIssues(params?: string | { locality?: string; district?: string; assignedDeptId?: string; status?: string }) {
  try {
    const queryParams: Record<string, string | undefined> = {};
    if (typeof params === 'string') {
      queryParams.locality = params;
    } else if (params) {
      if (params.locality) queryParams.locality = params.locality;
      if (params.district) queryParams.district = params.district;
      if (params.assignedDeptId) queryParams.assignedDeptId = params.assignedDeptId;
      if (params.status) queryParams.status = params.status;
    }

    const url = buildApiUrl('issues', queryParams);
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to fetch issues');
    const json = await res.json();
    return Array.isArray(json) ? json : json.data || [];
  } catch (error) {
    console.warn('Backend API offline or unreachable:', error);
    return [];
  }
}

export async function fetchLiveConflicts(locality?: string) {
  try {
    const apiBase = getApiBaseUrl();
    const url = new URL(`${apiBase}/projects/conflicts`);
    if (locality) url.searchParams.set('locality', locality);
    const res = await fetch(url.toString(), { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to fetch conflicts');
    const json = await res.json();
    return Array.isArray(json) ? json : json.data || [];
  } catch (error) {
    console.warn('Backend API offline or unreachable:', error);
    return [];
  }
}

export async function fetchLiveProjects(params?: string | { locality?: string; district?: string; departmentId?: string; status?: string }) {
  try {
    const queryParams: Record<string, string | undefined> = {};
    if (typeof params === 'string') {
      queryParams.locality = params;
    } else if (params) {
      if (params.locality) queryParams.locality = params.locality;
      if (params.district) queryParams.district = params.district;
      if (params.departmentId) queryParams.departmentId = params.departmentId;
      if (params.status) queryParams.status = params.status;
    }

    const url = buildApiUrl('projects', queryParams);
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to fetch projects');
    const json = await res.json();
    return Array.isArray(json) ? json : json.data || [];
  } catch (error) {
    console.warn('Backend API offline or unreachable:', error);
    return [];
  }
}

export async function createLiveProjectApi(projectData: any) {
  const apiBase = getApiBaseUrl();
  const res = await fetch(`${apiBase}/projects`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(projectData),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Failed to create infrastructure project' }));
    throw new Error(err.message || 'Failed to create infrastructure project');
  }
  return await res.json();
}

export async function updateProjectStatusApi(projectId: string, status: string) {
  const apiBase = getApiBaseUrl();
  const res = await fetch(`${apiBase}/projects/${projectId}/status`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify({ status }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Failed to update project status' }));
    throw new Error(err.message || 'Failed to update project status');
  }
  return await res.json();
}

export async function resolveConflictApi(conflictId: string, status: string, jointPlan?: string) {
  const apiBase = getApiBaseUrl();
  const res = await fetch(`${apiBase}/projects/conflicts/${conflictId}/resolve`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify({ status, jointPlan }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Failed to resolve conflict' }));
    throw new Error(err.message || 'Failed to resolve conflict');
  }
  return await res.json();
}

export async function updateIssueStatusApi(issueId: string, status: string, notes?: string) {
  const apiBase = getApiBaseUrl();
  const res = await fetch(`${apiBase}/issues/${issueId}/status`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify({ status, notes }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Failed to update issue status' }));
    throw new Error(err.message || 'Failed to update issue status');
  }
  return await res.json();
}

export async function updateUserProfileApi(profileData: {
  fullName?: string;
  bio?: string;
  email?: string;
  phone?: string;
  avatarUrl?: string;
  locality?: string;
  district?: string;
  wardNumber?: number;
  preferredLang?: string;
}) {
  const apiBase = getApiBaseUrl();
  const res = await fetch(`${apiBase}/auth/profile`, {
    method: 'PATCH',
    headers: getAuthHeaders(),
    body: JSON.stringify(profileData),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Failed to update profile' }));
    throw new Error(err.message || 'Failed to update profile');
  }
  return await res.json();
}

export async function uploadMediaApi(file: File): Promise<{ url: string; publicId?: string; bytes?: number }> {
  const apiBase = getApiBaseUrl();
  const formData = new FormData();
  formData.append('file', file);

  const token = getStoredToken();
  const headers: HeadersInit = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${apiBase}/storage/upload`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Upload failed' }));
    throw new Error(error.message || 'Failed to upload media file');
  }

  return await res.json();
}

export async function createLiveIssueApi(issueData: any) {
  const apiBase = getApiBaseUrl();
  const res = await fetch(`${apiBase}/issues`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(issueData),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Failed to record grievance' }));
    throw new Error(error.message || 'Failed to record civic issue');
  }

  return await res.json();
}

export async function toggleLikeApi(postId: string) {
  try {
    const apiBase = getApiBaseUrl();
    const res = await fetch(`${apiBase}/posts/${postId}/like`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function toggleSupportApi(issueId: string) {
  try {
    const apiBase = getApiBaseUrl();
    const res = await fetch(`${apiBase}/issues/${issueId}/support`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function deletePostOrIssueApi(id: string, isIssue?: boolean): Promise<boolean> {
  const apiBase = getApiBaseUrl();
  const headers = getAuthHeaders();

  // Try issue endpoint first if flagged as infrastructure issue
  if (isIssue) {
    try {
      const res = await fetch(`${apiBase}/issues/${id}`, {
        method: 'DELETE',
        headers,
      });
      if (res.ok) return true;
    } catch (err) {
      console.debug('Issue delete error:', err);
    }
  }

  // Try post endpoint
  try {
    const res = await fetch(`${apiBase}/posts/${id}`, {
      method: 'DELETE',
      headers,
    });
    if (res.ok) return true;
  } catch (err) {
    console.debug('Post delete error:', err);
  }

  // Fallback try issue endpoint
  if (!isIssue) {
    try {
      const res = await fetch(`${apiBase}/issues/${id}`, {
        method: 'DELETE',
        headers,
      });
      if (res.ok) return true;
    } catch (err) {
      console.debug('Fallback issue delete error:', err);
    }
  }

  return false;
}

export async function fetchLiveDepartments() {
  try {
    const apiBase = getApiBaseUrl();
    const res = await fetch(`${apiBase}/departments`, { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to fetch departments');
    return await res.json();
  } catch (error) {
    console.warn('Backend API offline or unreachable:', error);
    return [];
  }
}

// ----------------------------------------------------
// COMMUNITY DISCUSSIONS & GROUPS API
// ----------------------------------------------------

export async function fetchDiscussionsApi(params?: {
  type?: string;
  locality?: string;
  search?: string;
}) {
  try {
    const apiBase = getApiBaseUrl();
    const searchParams = new URLSearchParams();
    if (params?.type && params.type !== 'ALL') searchParams.set('type', params.type);
    if (params?.locality && params.locality !== 'all') searchParams.set('locality', params.locality);
    if (params?.search) searchParams.set('search', params.search);

    const queryStr = searchParams.toString();
    const url = `${apiBase}/discussions${queryStr ? `?${queryStr}` : ''}`;
    const res = await fetch(url, {
      headers: getAuthHeaders(),
      cache: 'no-store',
    });
    if (!res.ok) return [];
    return await res.json();
  } catch (err) {
    console.warn('Failed to fetch discussions:', err);
    return [];
  }
}

export async function createDiscussionApi(data: {
  name: string;
  description?: string;
  type: 'CHANNEL' | 'GROUP' | 'DIRECT';
  locality?: string;
  district?: string;
  category?: string;
  recipientUserId?: string;
}) {
  const apiBase = getApiBaseUrl();
  const res = await fetch(`${apiBase}/discussions`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Failed to create discussion space' }));
    throw new Error(error.message || 'Failed to create space');
  }

  return await res.json();
}

export async function fetchDiscussionByIdApi(roomId: string) {
  try {
    const apiBase = getApiBaseUrl();
    const res = await fetch(`${apiBase}/discussions/${roomId}`, {
      headers: getAuthHeaders(),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn('Failed to fetch discussion room:', err);
    return null;
  }
}

export async function joinChannelApi(roomId: string) {
  const apiBase = getApiBaseUrl();
  const res = await fetch(`${apiBase}/discussions/${roomId}/join`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Could not join channel' }));
    throw new Error(error.message || 'Could not join channel');
  }

  return await res.json();
}

export async function addMemberToGroupApi(
  roomId: string,
  data: { userId?: string; phone?: string; role?: string }
) {
  const apiBase = getApiBaseUrl();
  const res = await fetch(`${apiBase}/discussions/${roomId}/members`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Could not add member' }));
    throw new Error(error.message || 'Could not add member');
  }

  return await res.json();
}

export async function fetchDiscussionMessagesApi(roomId: string) {
  try {
    const apiBase = getApiBaseUrl();
    const res = await fetch(`${apiBase}/discussions/${roomId}/messages`, {
      headers: getAuthHeaders(),
      cache: 'no-store',
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => null);
      if (res.status === 403) {
        throw new Error(errData?.message || 'Access restricted');
      }
      return [];
    }
    return await res.json();
  } catch (err: any) {
    if (err.message?.includes('restricted') || err.message?.includes('private')) {
      throw err;
    }
    return [];
  }
}

export async function sendDiscussionMessageApi(
  roomId: string,
  data: { content: string; mediaUrl?: string }
) {
  const apiBase = getApiBaseUrl();
  const res = await fetch(`${apiBase}/discussions/${roomId}/messages`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Failed to send message' }));
    throw new Error(error.message || 'Failed to send message');
  }

  return await res.json();
}

export async function leaveDiscussionApi(roomId: string, userId: string) {
  const apiBase = getApiBaseUrl();
  const res = await fetch(`${apiBase}/discussions/${roomId}/members/${userId}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  return res.ok;
}

export interface PublicUserProfile {
  id: string;
  fullName: string;
  username: string;
  email?: string;
  phone?: string;
  avatarUrl?: string;
  locality?: string;
  district?: string;
  wardNumber?: number;
  role?: string;
  bio?: string;
  followersCount: number;
  followingCount: number;
  postsCount: number;
  grievancesCount: number;
  isFollowing: boolean;
  createdAt?: string;
}

export async function fetchUserProfileApi(identifier: string): Promise<PublicUserProfile | null> {
  try {
    const apiBase = getApiBaseUrl();
    const res = await fetch(`${apiBase}/auth/users/${encodeURIComponent(identifier)}`, {
      headers: getAuthHeaders(),
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.warn('Failed to fetch user profile:', err);
    return null;
  }
}

export async function toggleFollowUserApi(targetUserId: string): Promise<{ following: boolean; followersCount: number }> {
  const apiBase = getApiBaseUrl();
  const res = await fetch(`${apiBase}/auth/users/${encodeURIComponent(targetUserId)}/follow`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Failed to update follow status' }));
    throw new Error(error.message || 'Failed to follow user');
  }
  return await res.json();
}

export async function getOrCreateDirectRoomApi(targetUserId: string) {
  const apiBase = getApiBaseUrl();
  const res = await fetch(`${apiBase}/discussions/direct/${encodeURIComponent(targetUserId)}`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: 'Failed to start direct conversation' }));
    throw new Error(error.message || 'Failed to start direct conversation');
  }
  return await res.json();
}

export interface LiveNotification {
  id: string;
  userId: string;
  type: string;
  title: string;
  message: string;
  metadata?: any;
  isRead: boolean;
  createdAt: string;
}

export async function fetchNotificationsApi(): Promise<{ unreadCount: number; notifications: LiveNotification[] }> {
  try {
    const apiBase = getApiBaseUrl();
    const res = await fetch(`${apiBase}/notifications`, {
      headers: getAuthHeaders(),
      cache: 'no-store',
    });
    if (!res.ok) return { unreadCount: 0, notifications: [] };
    return await res.json();
  } catch (err) {
    console.warn('Failed to fetch notifications:', err);
    return { unreadCount: 0, notifications: [] };
  }
}

export async function markNotificationReadApi(id: string): Promise<boolean> {
  try {
    const apiBase = getApiBaseUrl();
    const res = await fetch(`${apiBase}/notifications/${id}/read`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
    });
    return res.ok;
  } catch (err) {
    return false;
  }
}

export async function markAllNotificationsReadApi(): Promise<boolean> {
  try {
    const apiBase = getApiBaseUrl();
    const res = await fetch(`${apiBase}/notifications/read-all`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
    });
    return res.ok;
  } catch (err) {
    return false;
  }
}

export async function triggerEscalationScanApi(): Promise<{ escalatedCount: number; issues: any[] }> {
  try {
    const apiBase = getApiBaseUrl();
    const res = await fetch(`${apiBase}/issues/escalate-scan`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    if (!res.ok) return { escalatedCount: 0, issues: [] };
    return await res.json();
  } catch (err) {
    return { escalatedCount: 0, issues: [] };
  }
}

export interface AiCivicResponse {
  answer: string;
  relevantIssues: {
    id: string;
    title: string;
    category?: string;
    status: string;
    locality: string;
    department?: string;
  }[];
  relevantProjects: {
    id: string;
    title: string;
    status: string;
    department: string;
  }[];
}

export async function askAiAssistantApi(
  question: string,
  locality?: string,
  district?: string
): Promise<AiCivicResponse> {
  const apiBase = getApiBaseUrl();
  const res = await fetch(`${apiBase}/ai/ask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ question, locality, district }),
  });
  if (!res.ok) {
    throw new Error('Failed to communicate with AI Civic Assistant');
  }
  return await res.json();
}

export async function translateTextApi(
  text: string,
  targetLang: 'en' | 'ml' | 'ta'
): Promise<{ translatedText: string; targetLang: string }> {
  try {
    const apiBase = getApiBaseUrl();
    const res = await fetch(`${apiBase}/ai/translate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, targetLang }),
    });
    if (!res.ok) {
      return { translatedText: text, targetLang };
    }
    return await res.json();
  } catch {
    return { translatedText: text, targetLang };
  }
}
