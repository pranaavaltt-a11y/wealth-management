import { z } from 'zod';

/**
 * API-layer validation. These mirror the CHECK constraints in the schema —
 * validation happens twice on purpose: Zod gives the user a readable error,
 * the database constraint guarantees nothing bad lands even if a query is
 * written by hand or run from psql.
 */

const money = z.coerce.number().positive().max(9_999_999_999_999).finite();
const moneyOrZero = z.coerce.number().min(0).max(9_999_999_999_999).finite();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

export const ASSET_TYPES = [
  'gold', 'property', 'equity', 'mutual_fund', 'epf', 'ppf', 'fd', 'vehicle', 'cash', 'other',
] as const;
export const LOAN_TYPES = [
  'home', 'vehicle', 'personal', 'education', 'gold', 'business', 'credit_card',
] as const;
export const TXN_TYPES = ['income', 'expense', 'asset', 'loan'] as const;

export const signupSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
  role: z.enum(['individual', 'advisor']).default('individual'),
  panNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'PAN must look like ABCDE1234F')
    .optional()
    .or(z.literal('').transform(() => undefined)),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export const assetSchema = z.object({
  name: z.string().trim().min(1).max(160),
  assetType: z.enum(ASSET_TYPES),
  purchaseValue: moneyOrZero,
  currentValue: moneyOrZero,
  purchaseDate: isoDate,
  valuationDate: isoDate.optional(),
  notes: z.string().trim().max(1000).optional().or(z.literal('')),
}).refine((v) => !v.valuationDate || v.valuationDate >= v.purchaseDate, {
  message: 'Valuation date cannot be before the purchase date',
  path: ['valuationDate'],
});

export const loanSchema = z.object({
  loanType: z.enum(LOAN_TYPES),
  lender: z.string().trim().min(1).max(160),
  principal: money,
  interestRate: z.coerce.number().gt(0).max(60),
  interestType: z.enum(['fixed', 'floating']).default('fixed'),
  tenureMonths: z.coerce.number().int().min(1).max(480),
  startDate: isoDate,
});

export const transactionSchema = z.object({
  txnType: z.enum(TXN_TYPES),
  amount: money,
  txnDate: isoDate,
  category: z.string().trim().min(1).max(80).default('uncategorized'),
  description: z.string().trim().max(500).optional().or(z.literal('')),
  relatedAssetId: z.coerce.number().int().positive().optional().nullable(),
  relatedLoanId: z.coerce.number().int().positive().optional().nullable(),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type AssetInput = z.infer<typeof assetSchema>;
export type LoanInput = z.infer<typeof loanSchema>;
export type TransactionInput = z.infer<typeof transactionSchema>;
