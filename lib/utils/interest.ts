import { toZonedTime, fromZonedTime } from 'date-fns-tz';

const VN_TIMEZONE = 'Asia/Ho_Chi_Minh';

// --- Money rounding helpers (2 decimals, half-up, cumulative-safe) ---
// We do intermediate money math in cents (1/100) using BigInt to avoid floating drift
// when calculating per-period interest and accumulating.
const CENTS = 100n;
const DAYS_IN_YEAR = 365n;
const PERCENT_DENOM = 100n;
const BPS_DENOM = 100n; // 1% = 100 bps (basis points)
const INTEREST_DENOM = DAYS_IN_YEAR * (PERCENT_DENOM * BPS_DENOM); // 365 * 10000

const toCentsBigInt = (amount: number): bigint => {
  if (!isFinite(amount)) return 0n;
  return BigInt(Math.round(amount * 100));
};

const fromCentsBigInt = (cents: bigint): number => Number(cents) / 100;

const toRateBpsBigInt = (ratePercentPerYear: number): bigint => {
  if (!isFinite(ratePercentPerYear)) return 0n;
  return BigInt(Math.round(ratePercentPerYear * 100));
};

const divRoundHalfUpPositive = (numerator: bigint, denominator: bigint): bigint => {
  if (denominator === 0n) return 0n;
  if (numerator <= 0n) return 0n;
  return (numerator + denominator / 2n) / denominator;
};

const calcInterestCents = (balanceCents: bigint, rateBps: bigint, days: number): bigint => {
  if (days <= 0) return 0n;
  if (balanceCents <= 0n || rateBps <= 0n) return 0n;
  const numer = balanceCents * rateBps * BigInt(days);
  return divRoundHalfUpPositive(numer, INTEREST_DENOM);
};

/**
 * Làm tròn kiểu Half-Up theo số chữ số thập phân.
 * Quy tắc: phần lẻ < 0.5 thì xuống, >= 0.5 thì lên (ví dụ 1.49 -> 1, 1.50 -> 2).
 * Hỗ trợ cả số âm (đối xứng quanh 0).
 */
export const roundHalfUp = (value: number, decimals: number = 0): number => {
  if (!isFinite(value)) return 0;
  const d = Number.isFinite(decimals) ? Math.max(0, Math.trunc(decimals)) : 0;
  const factor = 10 ** d;
  const scaled = value * factor;
  const eps = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4;
  if (scaled >= 0) return Math.floor(scaled + 0.5 + eps) / factor;
  return Math.ceil(scaled - 0.5 - eps) / factor;
};

/**
 * Helper: Convert date to VN timezone and get start of day
 */
export const getVNStartOfDay = (date: Date | string): Date => {
  const d = typeof date === 'string' ? new Date(date) : date;
  const vnDate = toZonedTime(d, VN_TIMEZONE);
  vnDate.setHours(0, 0, 0, 0);
  return fromZonedTime(vnDate, VN_TIMEZONE);
};

/**
 * Tính lãi theo cách của ngân hàng: lãi nhập gốc theo từng kỳ (tháng)
 * Mỗi kỳ tính lãi dựa trên số dư đầu kỳ, sau đó cộng lãi vào gốc để tính kỳ tiếp theo
 * 
 * Ví dụ từ phiếu ngân hàng:
 * - Kỳ 1 (21/08-01/09): Số dư 97,923,200 → Lãi 2,951 → Số dư mới 97,926,151
 * - Kỳ 2 (01/09-01/10): Số dư 97,926,151 → Lãi 8,049 → Số dư mới 97,934,200
 * - Kỳ 3 (01/10-01/11): Số dư 97,934,200 → Lãi 8,318 → Số dư mới 97,942,518
 * 
 * @param principal - Số tiền gốc
 * @param annualRate - Lãi suất năm (%)
 * @param startDate - Ngày bắt đầu tính lãi
 * @param endDate - Ngày kết thúc tính lãi
 * @returns Tổng lãi đã tính
 */
export const calculateInterest = (
    principal: number,
    annualRate: number,
    startDate: Date | string | undefined,
    endDate: Date
): number => {
    if (!startDate) return 0;

    // Handle different date input types
    let baseDate: Date;
    if (startDate instanceof Date) {
        baseDate = new Date(startDate);
    } else if (typeof startDate === 'object') {
        return 0;
    } else {
        baseDate = new Date(startDate);
    }

    // Validate baseDate
    if (isNaN(baseDate.getTime())) return 0;

    // Convert to VN timezone and reset to start of day (00:00:00 VN time)
    const baseDateVN = getVNStartOfDay(baseDate);
    const endDateVN = getVNStartOfDay(endDate);

    const timeDiff = endDateVN.getTime() - baseDateVN.getTime();
  const totalDays = Math.floor(timeDiff / (1000 * 3600 * 24));

    // Nếu chưa qua mốc 00:00 nào sau baseDate thì chưa có lãi
    if (totalDays <= 0) return 0;

    // Tính lãi theo cách ngân hàng: lãi nhập gốc theo từng kỳ (tháng)
    let currentBalanceCents = toCentsBigInt(principal);
    let totalInterestCents = 0n;
    let currentDate = new Date(baseDateVN);

    const rateBps = toRateBpsBigInt(annualRate);

    // Tính lãi theo từng kỳ (tháng)
    while (currentDate < endDateVN) {
        // Xác định ngày kết thúc kỳ (ngày đầu tháng tiếp theo)
        // Đảm bảo tính trong VN timezone
        const periodEnd = new Date(currentDate);
        periodEnd.setMonth(periodEnd.getMonth() + 1);
        periodEnd.setDate(1); // Ngày đầu tháng tiếp theo
        // Convert to VN timezone để đảm bảo nhất quán
        const periodEndVN = getVNStartOfDay(periodEnd);

        // Nếu periodEnd vượt quá endDate, dùng endDate
        const actualPeriodEnd = periodEndVN > endDateVN ? endDateVN : periodEndVN;

        // Số ngày trong kỳ này
    const daysInPeriod = Math.floor(
      (actualPeriodEnd.getTime() - currentDate.getTime()) / (1000 * 3600 * 24)
    );

    if (daysInPeriod > 0) {
      const periodInterestCents = calcInterestCents(currentBalanceCents, rateBps, daysInPeriod);
      totalInterestCents += periodInterestCents;
      currentBalanceCents += periodInterestCents;
    }

        // Chuyển sang kỳ tiếp theo
        currentDate = new Date(actualPeriodEnd);
    }

    return fromCentsBigInt(totalInterestCents);
};

/**
 * Tính lãi với mốc thay đổi lãi suất (ví dụ: 01/01/2026)
 * Tính liên tục theo từng kỳ tháng, áp dụng lãi suất phù hợp cho từng kỳ
 * @param principal - Số tiền gốc ban đầu
 * @param baseDate - Ngày bắt đầu tính lãi
 * @param endDate - Ngày kết thúc tính lãi
 * @param rateChangeDate - Ngày thay đổi lãi suất (ví dụ: 01/01/2026)
 * @param rateBefore - Lãi suất trước mốc (%)
 * @param rateAfter - Lãi suất sau mốc (%)
 * @returns Tổng lãi và chi tiết 2 giai đoạn
 */
export const calculateInterestWithRateChange = (
    principal: number,
    baseDate: Date | string | undefined,
    endDate: Date,
    rateChangeDate: Date | string,
    rateBefore: number,
    rateAfter: number
): { 
    totalInterest: number; 
    interestBefore: number; 
    interestAfter: number;
    balanceAtChange: number; // Số dư tại mốc thay đổi (gốc + lãi trước mốc)
} => {
    if (!baseDate) {
        return {
            totalInterest: 0,
            interestBefore: 0,
            interestAfter: 0,
            balanceAtChange: principal
        };
    }

    const baseDateVN = getVNStartOfDay(baseDate);
    const endDateVN = getVNStartOfDay(endDate);
    const changeDateVN = getVNStartOfDay(rateChangeDate);

    // Nếu endDate trước mốc thay đổi, chỉ tính với rateBefore
    if (endDateVN <= changeDateVN) {
        const interest = calculateInterest(principal, rateBefore, baseDateVN, endDateVN);
        return {
            totalInterest: interest,
            interestBefore: interest,
            interestAfter: 0,
            balanceAtChange: principal + interest
        };
    }

    // Nếu baseDate sau mốc thay đổi, chỉ tính với rateAfter
    if (baseDateVN >= changeDateVN) {
        const interest = calculateInterest(principal, rateAfter, baseDateVN, endDateVN);
        return {
            totalInterest: interest,
            interestBefore: 0,
            interestAfter: interest,
            balanceAtChange: principal
        };
    }

    // Tính lãi liên tục theo từng kỳ tháng, áp dụng lãi suất phù hợp cho từng kỳ
    // Logic: Lãi nhập gốc theo từng kỳ tháng (từ đầu tháng đến đầu tháng tiếp theo)
    let currentBalanceCents = toCentsBigInt(principal);
    let totalInterestCents = 0n;
    let interestBeforeCents = 0n;
    let interestAfterCents = 0n;
    let currentDate = new Date(baseDateVN);
    let balanceAtChangeCents = currentBalanceCents;

    const rateBeforeBps = toRateBpsBigInt(rateBefore);
    const rateAfterBps = toRateBpsBigInt(rateAfter);

    while (currentDate < endDateVN) {
        // Xác định ngày kết thúc kỳ (ngày đầu tháng tiếp theo)
        const periodEnd = new Date(currentDate);
        periodEnd.setMonth(periodEnd.getMonth() + 1);
        periodEnd.setDate(1);
        const periodEndVN = getVNStartOfDay(periodEnd);

        // Nếu periodEnd vượt quá endDate, dùng endDate
        const actualPeriodEnd = periodEndVN > endDateVN ? endDateVN : periodEndVN;
        
        // Xác định lãi suất cho kỳ này
        // Nếu kỳ bắt đầu từ trước mốc thay đổi và kết thúc sau mốc, cần chia kỳ
        const periodStartsBeforeChange = currentDate < changeDateVN;
        const periodEndsAfterChange = actualPeriodEnd > changeDateVN;
        const changeDateIsInPeriod = periodStartsBeforeChange && periodEndsAfterChange;
        
        if (changeDateIsInPeriod) {
            // Kỳ này chứa mốc thay đổi: chia thành 2 phần
            // Phần 1: Từ currentDate đến changeDate (dùng rateBefore)
            const daysBeforeChange = Math.floor(
                (changeDateVN.getTime() - currentDate.getTime()) / (1000 * 3600 * 24)
            );
            if (daysBeforeChange > 0) {
                const periodInterestBeforeCents = calcInterestCents(currentBalanceCents, rateBeforeBps, daysBeforeChange);
                interestBeforeCents += periodInterestBeforeCents;
                totalInterestCents += periodInterestBeforeCents;
                currentBalanceCents += periodInterestBeforeCents;
                balanceAtChangeCents = currentBalanceCents; // Lưu số dư tại mốc thay đổi
            }
            
            // Phần 2: Từ changeDate đến actualPeriodEnd (dùng rateAfter)
            const daysAfterChange = Math.floor(
                (actualPeriodEnd.getTime() - changeDateVN.getTime()) / (1000 * 3600 * 24)
            );
            if (daysAfterChange > 0) {
                const periodInterestAfterCents = calcInterestCents(currentBalanceCents, rateAfterBps, daysAfterChange);
                interestAfterCents += periodInterestAfterCents;
                totalInterestCents += periodInterestAfterCents;
                currentBalanceCents += periodInterestAfterCents;
            }
        } else {
            // Kỳ bình thường: dùng rateBefore hoặc rateAfter
            const daysInPeriod = Math.floor(
                (actualPeriodEnd.getTime() - currentDate.getTime()) / (1000 * 3600 * 24)
            );
            
            if (daysInPeriod > 0) {
                // Xác định lãi suất: nếu kỳ bắt đầu từ mốc thay đổi trở đi, dùng rateAfter
                const useRateAfter = currentDate >= changeDateVN;
                const currentRateBps = useRateAfter ? rateAfterBps : rateBeforeBps;
                const periodInterestCents = calcInterestCents(currentBalanceCents, currentRateBps, daysInPeriod);

                if (useRateAfter) {
                    interestAfterCents += periodInterestCents;
                } else {
                    interestBeforeCents += periodInterestCents;
                }

                totalInterestCents += periodInterestCents;
                currentBalanceCents += periodInterestCents;
                
                // Lưu số dư tại mốc thay đổi nếu kỳ này kết thúc đúng tại mốc
                if (!useRateAfter && actualPeriodEnd.getTime() === changeDateVN.getTime()) {
                    balanceAtChangeCents = currentBalanceCents;
                }
            }
        }

        // Chuyển sang kỳ tiếp theo
        currentDate = new Date(actualPeriodEnd);
    }

    return {
        totalInterest: fromCentsBigInt(totalInterestCents),
        interestBefore: fromCentsBigInt(interestBeforeCents),
        interestAfter: fromCentsBigInt(interestAfterCents),
        balanceAtChange: fromCentsBigInt(balanceAtChangeCents)
    };
};
