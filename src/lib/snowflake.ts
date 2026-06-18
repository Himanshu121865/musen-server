const EPOCH = 1700000000000n;
const WORKER_ID = 1n;
const PROCESS_ID = 1n;
let sequence = 0n;
let lastTimestamp = 0n;

export function generateSnowflake(): string {
  let now = BigInt(Date.now()) - EPOCH;
  if (now === lastTimestamp) {
    sequence = (sequence + 1n) & 0xfffn;
  } else {
    sequence = 0n;
    lastTimestamp = now;
  }
  const id = (now << 22n) | (PROCESS_ID << 17n) | (WORKER_ID << 12n) | sequence;
  return id.toString();
}
