declare module "bakong-khqr" {
  export const khqrData: { currency: { khr: number; usd: number } };
  export class IndividualInfo {
    constructor(
      bakongAccountID: string,
      merchantName: string,
      merchantCity: string,
      optional?: Record<string, unknown>
    );
  }
  export class MerchantInfo extends IndividualInfo {
    constructor(
      bakongAccountID: string,
      merchantName: string,
      merchantCity: string,
      merchantID: string,
      acquiringBank: string,
      optional?: Record<string, unknown>
    );
  }
  export interface KHQRStatus {
    code: number;
    errorCode?: unknown;
    message?: string | null;
  }
  export interface KHQRData {
    qr: string;
    md5: string;
  }
  export class BakongKHQR {
    generateIndividual(info: IndividualInfo): { status: KHQRStatus; data: KHQRData | null };
    generateMerchant(info: MerchantInfo): { status: KHQRStatus; data: KHQRData | null };
    static verify(qr: string): { isValid: boolean };
    static decode(qr: string): { status: KHQRStatus; data: Record<string, unknown> | null };
    static checkBakongAccount(url: string, bakongID: string): Promise<{ status: KHQRStatus; data: { bakongAccountExisted: boolean } | null }>;
  }
}
