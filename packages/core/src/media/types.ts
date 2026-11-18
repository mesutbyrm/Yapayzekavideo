export interface MediaCandidate {
  provider: string;
  providerId: string;
  kind: "VIDEO" | "IMAGE";
  downloadUrl?: string;
  /** Kütüphane varlıkları için depolama anahtarı */
  storageKey?: string;
  sourceUrl: string;
  width: number;
  height: number;
  durationSec?: number;
  license: string;
  licenseUrl?: string;
  commercialUse: boolean;
  author?: string;
  attribution?: string;
  tags?: string[];
  /** Zaten veritabanında kayıtlıysa */
  assetId?: string;
}

export interface SearchOptions {
  brandId: string;
  minDurationSec: number;
  orientation: "portrait" | "landscape" | "square";
  excludeProviderIds?: Set<string>;
}

export interface MediaProvider {
  readonly id: string;
  /** Ücretli mi? (bütçe kontrolü için) */
  readonly paid: boolean;
  isConfigured(): boolean;
  search(keywords: string[], opts: SearchOptions): Promise<MediaCandidate[]>;
}
