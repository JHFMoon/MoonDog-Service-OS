export const MAX_UX_SAMPLE_ATTEMPTS=2;

export function shouldRetryUxSample(failed,attemptNumber){
  return failed===true&&Number.isSafeInteger(attemptNumber)&&attemptNumber>=1&&attemptNumber<MAX_UX_SAMPLE_ATTEMPTS;
}

export function sanitizeUxFailureReason(error){
  const message=String(error?.message||error||"Unknown synthetic browser failure");
  return message
    .replace(/(["'])(?:file:\/\/|(?:[a-z]:[\\/]|\/(?!\/))[^"'\r\n]*)\1/gi,"[redacted-path]")
    .replace(/file:\/\/[^\s"'<>]+/gi,"[redacted-file-url]")
    .replace(/https?:\/\/[^\s"'<>]+/gi,"[redacted-url]")
    .replace(/\b(authorization|proxy-authorization)\s*[:=]\s*(?:(?:bearer|basic)\s+)?(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^,\s;}]+)(?:\s+[^,;}]+)?/gi,"$1=[redacted]")
    .replace(/(["']?)(api[_-]?key|token|password|secret|private[_ -]?key|authorization|credential|cookie)(["']?)\s*[:=]\s*(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s,;}\]]+)/gi,"$1$2$3=[redacted]")
    .replace(/(?:[a-z]:[\\/])[^\s"'<>]+/gi,"[redacted-path]")
    .replace(/(?<![\w:/])\/(?!\/)[^\s"'<>]+/g,"[redacted-path]")
    .replace(/[\r\n\t]+/g," ")
    .replace(/\s+/g," ")
    .trim()
    .slice(0,240);
}
