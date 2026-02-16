-- AlterTable
-- Add processAt for delayed Venmo/CashApp add/withdraw (24h)
ALTER TABLE "Transaction" ADD COLUMN "processAt" TIMESTAMPTZ(6);
