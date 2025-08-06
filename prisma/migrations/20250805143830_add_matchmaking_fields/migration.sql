/*
  Warnings:

  - You are about to alter the column `Wallet` on the `Users` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Integer`.
  - You are about to alter the column `Earnings` on the `Users` table. The data in that column could be lost. The data in that column will be cast from `Decimal` to `Integer`.

*/
-- AlterTable
ALTER TABLE "Match_History" ADD COLUMN     "PointDiff" INTEGER,
ADD COLUMN     "RivalryHeat" DOUBLE PRECISION DEFAULT 0,
ADD COLUMN     "StakeAmount" DECIMAL;

-- AlterTable
ALTER TABLE "Users" ADD COLUMN     "Active" BOOLEAN DEFAULT true,
ADD COLUMN     "Elo" DOUBLE PRECISION DEFAULT 1000,
ADD COLUMN     "LastMMIUpdate" TIMESTAMP(3),
ADD COLUMN     "Online" BOOLEAN DEFAULT false,
ALTER COLUMN "Wallet" DROP DEFAULT,
ALTER COLUMN "Wallet" SET DATA TYPE INTEGER,
ALTER COLUMN "Earnings" SET DATA TYPE INTEGER;
