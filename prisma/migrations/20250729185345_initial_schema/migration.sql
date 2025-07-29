-- CreateTable
CREATE TABLE "Discord_Threads" (
    "id" SERIAL NOT NULL,
    "ThreadId" VARCHAR NOT NULL,
    "Members" INTEGER[],
    "Open" BOOLEAN NOT NULL DEFAULT true,
    "Dispute" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Discord_Threads_pkey1" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lookup_Badge" (
    "id" SERIAL NOT NULL,
    "Badge" VARCHAR,
    "Description" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lookup_Badge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lookup_Game" (
    "id" SERIAL NOT NULL,
    "Game" TEXT,
    "API" VARCHAR,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lookup_Games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lookup_PaymentType" (
    "id" SERIAL NOT NULL,
    "Type" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lookup_PaymentType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lookup_Status" (
    "id" SERIAL NOT NULL,
    "Status" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lookup_Status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match_History" (
    "id" SERIAL NOT NULL,
    "Game" INTEGER,
    "P1" VARCHAR,
    "P2" VARCHAR,
    "Status" INTEGER,
    "Result" BOOLEAN,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Discord_Threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Users" (
    "id" SERIAL NOT NULL,
    "Username" TEXT,
    "Rank" INTEGER,
    "Wallet" DECIMAL NOT NULL DEFAULT 0,
    "PaymentType" INTEGER NOT NULL DEFAULT 1,
    "PayPalPayerId" VARCHAR,
    "BillingAgreementId" VARCHAR,
    "CardLast" DECIMAL,
    "CardBrand" VARCHAR,
    "CardExpMonth" DECIMAL,
    "CardExpYear" DECIMAL,
    "Rivals" INTEGER[],
    "Badges" INTEGER[],
    "Discord" VARCHAR,
    "Avatar" VARCHAR,
    "Authenticated" BOOLEAN NOT NULL DEFAULT false,
    "Password" VARCHAR,
    "Email" VARCHAR,
    "WinsLosses" JSON,
    "Streak" INTEGER DEFAULT 0,
    "Earnings" DECIMAL,
    "JWT" VARCHAR,
    "StripePayerId" VARCHAR,

    CONSTRAINT "Test-User-Table_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" SERIAL NOT NULL,
    "UserId" INTEGER NOT NULL,
    "Type" VARCHAR NOT NULL,
    "Amount" DECIMAL NOT NULL,
    "Currency" VARCHAR NOT NULL DEFAULT 'USD',
    "Description" VARCHAR,
    "StripePaymentIntentId" VARCHAR,
    "StripePayoutId" VARCHAR,
    "Status" VARCHAR NOT NULL DEFAULT 'completed',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Users_Email_key" ON "Users"("Email");

-- AddForeignKey
ALTER TABLE "Match_History" ADD CONSTRAINT "Match_History_Game_fkey" FOREIGN KEY ("Game") REFERENCES "Lookup_Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match_History" ADD CONSTRAINT "Match_History_Status_fkey" FOREIGN KEY ("Status") REFERENCES "Lookup_Status"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Users" ADD CONSTRAINT "Users_PaymentType_fkey" FOREIGN KEY ("PaymentType") REFERENCES "Lookup_PaymentType"("id") ON DELETE SET DEFAULT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_UserId_fkey" FOREIGN KEY ("UserId") REFERENCES "Users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
