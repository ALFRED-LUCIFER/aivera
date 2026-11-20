// The browser's PUT straight to Blob storage with the SAS URL (AIV-P0-016). XMLHttpRequest, because fetch reports no
// upload progress. The file never passes through the web app.

/**
 * Resolves true once Blob storage stored the file. `contentType` is the one the upload was requested with: the server
 * re-checks it against the stored blob. `onProgress` gets whole percentages.
 */
export function putBlob(
  url: string,
  file: File,
  contentType: string,
  onProgress: (percent: number) => void,
): Promise<boolean> {
  return new Promise((resolve) => {
    const request = new XMLHttpRequest();
    request.open('PUT', url);
    request.setRequestHeader('x-ms-blob-type', 'BlockBlob');
    request.setRequestHeader('x-ms-blob-content-type', contentType);
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(Math.floor((event.loaded / event.total) * 100));
    });
    request.addEventListener('load', () => resolve(request.status === 201));
    request.addEventListener('error', () => resolve(false));
    request.addEventListener('abort', () => resolve(false));
    request.send(file);
  });
}
