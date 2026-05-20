# AgentGuard POC — 7702 + Session Key + Paymaster

Standalone proof-of-concept validating the technical stack before building the SDK + dashboard.

**What this proves:**
1. An EOA can be 7702-delegated to a ZeroDev Kernel v3 smart account at the *same address*
2. A session key can be installed with permissions (target / value limit)
3. The session key can sign a UserOp that gets bundled and executed on-chain
4. Paymaster sponsors gas — the user pays zero
5. The validator rejects out-of-policy attempts

**If all five pass, the architecture in SPEC.md is buildable.**

---

## Setup (one-time, ~5 minutes)

### 1. Install deps

```bash
cd poc-7702
npm install
```

### 2. Get a ZeroDev project

- Go to https://dashboard.zerodev.app and sign up
- Create a new project → select **Base Sepolia**
- Copy the **Bundler RPC** and **Paymaster RPC** URLs
- ZeroDev's free tier covers this POC

### 3. Generate an Owner private key

```bash
node -e "console.log('0x' + require('crypto').randomBytes(32).toString('hex'))"
```

Save it — this is your test "user."

### 4. Fund the Owner with Base Sepolia ETH

The 7702 authorization tuple needs to be included in a transaction. The bundler/paymaster handles gas for UserOps, but for the initial 7702 auth we want a tiny bit of ETH on the owner.

- Get the owner address: `node -e "const { privateKeyToAccount } = require('viem/accounts'); console.log(privateKeyToAccount('0xYOUR_KEY').address)"`
- Faucet: https://www.alchemy.com/faucets/base-sepolia (or any Base Sepolia faucet)
- Drip 0.01 ETH

### 5. Get some test USDC

- Circle's Base Sepolia USDC faucet: https://faucet.circle.com
- Select Base Sepolia → enter the owner address → drip
- POC needs only 0.05 USDC to run

### 6. Fill in `.env`

```bash
cp .env.example .env
# edit .env with your values
```

---

## Run

```bash
npm run poc
```

Expected output:

```
🔐 Step 1: Owner EOA = 0xABC...
   Smart account address (7702) = 0xABC... (same address)

🔑 Step 2: Generated session key
   Session key address = 0xDEF...
   Policy: only USDC transfers, max 0.01 USDC per call

📝 Step 3: Submitting 7702 authorization + installing session key...
   UserOp hash: 0x123...
   Tx mined: 0x456...

🚀 Step 4: Session key signs a 0.001 USDC transfer to 0xdead...
   UserOp hash: 0x789...
   Tx mined: 0xabc...
   ✓ Gas paid by paymaster (user paid 0 ETH)

🚫 Step 5: Trying to transfer 1 USDC (above 0.01 limit)...
   Expected to fail — validator should reject.
   ✓ Rejected as expected.

✅ POC complete — tech stack validated.
```

---

## Troubleshooting

- **`Insufficient ETH to send authorization tuple`** — fund the owner address with a tiny bit of Sepolia ETH (step 4)
- **`Bundler returned 0x...`** — usually means your ZeroDev project isn't on Base Sepolia. Check the RPC URLs.
- **`Permission policy not satisfied`** — expected for Step 5; that's the whole point. If Step 4 fails with this, double-check the USDC address.
- **API version mismatches** — ZeroDev SDK is actively developed; if you hit import errors, check https://docs.zerodev.app/sdk/getting-started for the current API surface.

---

## What to do after this works

Move on to **M1** in `../SPEC.md` — wrap this into an SDK package + start the dashboard scaffold.
