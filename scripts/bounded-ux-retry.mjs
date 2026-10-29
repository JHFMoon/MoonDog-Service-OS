export const MAX_UX_SAMPLE_ATTEMPTS=2;

export function shouldRetryUxSample(failed,attemptNumber){
  return failed===true&&Number.isSafeInteger(attemptNumber)&&attemptNumber>=1&&attemptNumber<MAX_UX_SAMPLE_ATTEMPTS;
}

export function sanitizeUxFailureReason(error){
  const message=String(error?.message||error||"Unknown synthetic browser failure");
  return message
    .replace(/(?:[A-Z]:[\\/]|\/(?:home|Users|workspace|tmp|runner|var|opt|mnt)\/)[^\s"'<>]*/g,"[path]")
    .replace(/\b(authorization|proxy-authorization)\s*[:=]\s*(?:bearer|basic)\s+["']?[^,\s"'<>]+["']?/gi,"$1=[redacted]")
    .replace(/(["']?)(api[_-]?key|token|password|secret|private[_ -]?key|authorization|credential)(["']?)\s*[:=]\s*(?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s,;}\]]+)/gi,"$1$2$3=[redacted]")
    .replace(/[\r\n\t]+/g," ")
    .replace(/\s+/g," ")
    .trim()
    .slice(0,240);
}
