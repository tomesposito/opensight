/** Local inventory budgets, not AWS format limits. No files are extracted. */
export const ZIP_LIMITS = Object.freeze({
  archiveBytes: 32 * 1024 * 1024,
  memberBytes: 16 * 1024 * 1024,
  totalBytes: 64 * 1024 * 1024,
  members: 1000,
});

export interface ZipMemberInfo {
  path: string;
  compressedSize: number;
  uncompressedSize: number;
  directory: boolean;
}

export function memberJsonPath(path: string): string {
  return `$[${JSON.stringify(path)}]`;
}
