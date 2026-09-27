let pendingUpload: File | null = null;

export function setPendingUpload(file: File) {
  pendingUpload = file;
}

export function takePendingUpload() {
  const file = pendingUpload;
  pendingUpload = null;
  return file;
}
