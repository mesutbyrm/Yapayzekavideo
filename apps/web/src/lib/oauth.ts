import { env } from "@asf/core";

/** Platform geliştirici konsoluna kaydedilmesi gereken yönlendirme adresi */
export function redirectUri(platform: string) {
  return `${env().APP_URL.replace(/\/$/, "")}/api/oauth/${platform}/callback`;
}
