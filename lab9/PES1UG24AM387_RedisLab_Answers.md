# PES1UG24AM387 – Redis Lab answers (verified on redis-server)

**Q1**: `MSET` → OK. `MGET` → 1) "20" 2) "50".

**Q2**: `RPUSH` → 2. `LRANGE` → Hello, Hi! How can I help?. `LPUSH` → 3. The list is now SYSTEM: be concise, Hello, Hi! How can I help?

**Q3**: `HSET` → **3**, because 3 new fields were created. plan → "free". `HGETALL` → name Meera, plan free, credits 10. `HINCRBY` → **60**. `HLEN` → **3**.

**Q4**: `SET … EX 120` → OK. `INCRBY quota:u1 -3` → **17**.
`APPEND` → **(integer) 13**. This is the new length in characters of the string "Online (busy)" (6 + 7).
`MGET` → "483920", "17", **(nil)**. quota:u99 does not exist, so Redis returns nil for it.

**Q5**: `SADD` → 3. `SMEMBERS` → u1 u2 u3 (in no set order). `SISMEMBER` → 1.
`SADD beta:gpt-next u2 u4` → **(integer) 1**. Only u4 is new: u2 is already a member, and SADD counts only newly added members.
`SCARD` → **4**. `SREM … u4` → 1.

**Q6**: `ZADD` → 3. `ZCARD` → 3. `ZREVRANGE` → ben, ava, cara. `ZINCRBY` → **1000**.
`WITHSCORES` → cara 1000, ben 800, ava 500. **cara is #1.**

**Q7**: `RPUSH` → 3. `LPUSH URGENT-1` → 4. The queue is URGENT-1, T1, T2, T3.
`LPOP` → **"URGENT-1"**. `RPOP` → **"T3"**. `RPUSH T4 T5` → 4. `LTRIM 0 1` → OK. The queue is now **T1, T2**.

**Q8**: `HSET` → 3. `HINCRBY credits -30` → **70**. `HINCRBY messages 1` → **1**, because a missing field starts at 0.
`HDEL plan` → 1. `HEXISTS plan` → **0**. `HLEN` → **3**. `HGETALL` → name Ravi, credits 70, messages 1.

**Q9**: `ZADD` → 4. `ZCARD` → 4. `ZREVRANGE` → ben, dev, ava, cara. `ZINCRBY 400 ava` → **900**.
`ZREVRANK ava` → **0**: 900 is now the highest score. `ZRANK cara` → **0**: 300 is the lowest score.
`ZREM ben` → 1. The leaderboard is now ava 900, dev 600, cara 300.

**Q10**:
1. String: `SET otp:u5 "7781" EX 60` → OK
2. List: `RPUSH conv:5 "Hi"` → 1
3. Hash: `HSET user:5 name "Neha" plan "free"` → 2
4. Set: `SADD beta:gpt-next u5` → 1
5. Sorted Set: `ZADD leaderboard:tokens 250 u5` → 1
6. `SADD beta:gpt-next u5` again → **(integer) 0**. u5 is already a member and a set never holds duplicates, so nothing new was added. This is not an error.
7. `RPUSH user:5 "hello"` → **(error) WRONGTYPE Operation against a key holding the wrong kind of value**. user:5 was created as a Hash. A key holds only one type, so a List command on it is rejected and the hash stays unchanged.
