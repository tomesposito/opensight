import { createEmbeddingClient, ssoNotConfigured, type EmbedRequest, type EmbeddedContent } from '@opensight/embedding-sdk';
const client = createEmbeddingClient({ apiOrigin: 'https://api.example.com', onAuthenticationRequired: ssoNotConfigured });
const request: EmbedRequest = { dashboardId: 'dashboard', parentOrigin: 'https://app.example.com' };
const generate: (request: EmbedRequest, signal?: AbortSignal) => Promise<{ url: string; expiresAt: string }> = client.generateEmbedUrl;
const embed: Promise<EmbeddedContent> = client.embedDashboard(document.createElement('div'), request);
// @ts-expect-error Single visual embeddings require a visual ID.
client.embedVisual(document.createElement('div'), request);
void generate; void embed;
