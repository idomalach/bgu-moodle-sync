# 🔐 AI-Assisted Code Security Guide
> A living reference for Claude and Ido — to be consulted before writing, reviewing, or shipping code together.

---

## Why This Document Exists

AI-generated code looks correct and passes review — that's exactly what makes it dangerous.
Research shows AI tools introduce vulnerabilities at **4× the rate of human-authored code**, not because the code is low quality, but because it's *high-confidence insecure code*. The patterns repeat across projects, which means if we don't actively guard against them, they'll silently accumulate.

This guide is a checklist, a reminder, and a contract between us.

---

## 🚨 The Top Risk: Pattern Propagation

**What it means:** If the existing codebase has insecure patterns, I will confidently reproduce them — and they'll look intentional.

**What we do about it:**
- Treat this doc as a baseline that overrides inherited patterns
- When I write code that mirrors existing patterns, you can ask: *"Is this pattern safe, or are you just copying it?"*
- I will flag when I'm reproducing a pattern I'm unsure about

---

## 1. Injection Vulnerabilities

### SQL Injection
❌ **Never do this:**
```javascript
const query = `SELECT * FROM users WHERE id = ${userId}`;
db.query(query);
```

✅ **Always use parameterized queries:**
```javascript
const query = `SELECT * FROM users WHERE id = ?`;
db.query(query, [userId]);
```

### NoSQL Injection (MongoDB, Firebase)
❌ Never build queries from raw user input:
```javascript
db.collection('users').find({ username: req.body.username });
// If req.body.username = { $gt: "" } → dumps all users
```

✅ Validate and sanitize input types before querying.

### Template Injection
❌ Never pass user input directly into template engines:
```javascript
res.render(userProvidedTemplate); // catastrophic
```

✅ Always use static template names; pass data as variables only.

### Command Injection
❌ Never pass user input to shell commands:
```javascript
exec(`ffmpeg -i ${userFile} output.mp4`);
```

✅ Use argument arrays and validated input:
```javascript
execFile('ffmpeg', ['-i', sanitizedPath, 'output.mp4']);
```

---

## 2. Authentication & Authorization

### Missing or Weak Auth Checks
- Every route/function that touches user data **must** verify identity
- Auth checks belong in **middleware**, not scattered ad-hoc per route
- Never rely on client-side auth state as the source of truth

### Insecure JWT Handling
❌ Never accept `alg: none` in JWTs  
❌ Never store JWTs in `localStorage` (XSS-accessible)  
✅ Use `httpOnly` cookies for JWT storage  
✅ Always verify signature AND expiry  

### Missing Authorization (IDOR)
❌ Checking that a user is *logged in* is not enough:
```javascript
// User A can access User B's data just by changing the ID
GET /api/orders/12345
```

✅ Always check that the authenticated user **owns** the resource:
```javascript
if (order.userId !== req.user.id) return res.status(403).send('Forbidden');
```

### Password Handling
❌ Never store plain-text passwords  
❌ Never use MD5 or SHA1 for passwords  
✅ Always use bcrypt, argon2, or scrypt with proper salt rounds  

---

## 3. Input Validation & Integrity Controls

> ⚠️ Missing integrity controls are the **#1 most common AI-generated vulnerability** (~15% of findings).

**Rules:**
- Validate **type**, **format**, **length**, and **range** of ALL user inputs
- Validate on the **server side** — client-side validation is UX only, not security
- Reject unexpected fields (use allowlists, not blocklists)
- Never trust `Content-Type` headers alone for file uploads

```javascript
// Example: validate before using
const { body, validationResult } = require('express-validator');

app.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('age').isInt({ min: 0, max: 120 }),
  body('name').isLength({ min: 1, max: 100 }).trim().escape(),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  // proceed...
});
```

---

## 4. Secrets & Environment Variables

❌ **Never hardcode secrets:**
```javascript
const apiKey = "sk-abc123..."; // NEVER
const dbPassword = "hunter2"; // NEVER
```

✅ **Always use environment variables:**
```javascript
const apiKey = process.env.ANTHROPIC_API_KEY;
```

**Rules:**
- `.env` files must always be in `.gitignore`
- Never log environment variables, even in debug mode
- Rotate any secret that has ever touched version control
- Use a secrets manager (AWS Secrets Manager, Doppler, etc.) for production
- I will never write hardcoded secrets — if I do, flag it immediately

---

## 5. Dependency & Supply Chain Security

- Regularly run `npm audit` / `pip audit` and address HIGH/CRITICAL findings
- Never install packages with `--ignore-scripts` disabled (some run malicious install scripts)
- Pin dependency versions in production (`package-lock.json`, `requirements.txt`)
- Prefer well-maintained, widely-used packages over obscure ones
- I will flag when I suggest a package I'm not confident about

---

## 6. API Security

### Rate Limiting
All public-facing APIs must have rate limiting. Without it:
- Brute-force attacks on login endpoints
- Credential stuffing
- Scraping / abuse

```javascript
const rateLimit = require('express-rate-limit');
app.use('/api/', rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));
```

### CORS
❌ Never use wildcard CORS in production:
```javascript
res.header("Access-Control-Allow-Origin", "*"); // dangerous
```

✅ Allowlist specific origins:
```javascript
const allowedOrigins = ['https://yourdomain.com'];
```

### Sensitive Data in URLs
❌ Never put tokens, passwords, or PII in URL parameters:
```
/reset-password?token=abc123&email=user@example.com  ❌
```

✅ Use POST body or headers for sensitive data.

---

## 7. XSS (Cross-Site Scripting)

### React / React Native
React escapes JSX by default — but these patterns bypass it:
```jsx
// ❌ DANGER - never use with untrusted content
<div dangerouslySetInnerHTML={{ __html: userContent }} />

// ❌ DANGER
eval(userCode);
new Function(userCode)();
```

✅ Never render raw HTML from user input. If rich text is needed, use a sanitization library like `DOMPurify`.

---

## 8. Data Exposure

### Over-returning Data
❌ Never return full database objects to the client:
```javascript
res.json(await User.findById(id)); // may include passwordHash, tokens, internal flags
```

✅ Explicitly select and return only needed fields:
```javascript
const { name, email, createdAt } = user;
res.json({ name, email, createdAt });
```

### Error Messages
❌ Never expose stack traces or internal errors to users:
```javascript
res.status(500).json({ error: err.message, stack: err.stack }); // exposes internals
```

✅ Log internally, return generic messages externally:
```javascript
console.error(err);
res.status(500).json({ error: 'Something went wrong. Please try again.' });
```

---

## 9. File Upload Security

If we ever handle file uploads (e.g., pet photos in Bond & Seek):

- Validate file type server-side (don't trust the extension or MIME type from client)
- Store uploads outside the web root, or in object storage (S3/GCS)
- Rename files on upload (never use the original filename)
- Scan for malware if handling untrusted uploads at scale
- Set strict file size limits

---

## 10. Mobile-Specific (React Native / Bond & Seek)

### AsyncStorage
- Never store sensitive data (tokens, passwords) in AsyncStorage — it's unencrypted
- Use `expo-secure-store` or `react-native-keychain` for secrets

### Deep Links
- Validate all incoming deep link parameters before use
- Never auto-execute actions from deep links without user confirmation

### API Keys in App Bundle
- Never embed API keys directly in the app binary
- Use a backend proxy so keys never leave the server

### Certificate Pinning (for high-security features)
- Consider certificate pinning for API calls involving financial or health data

---

## 11. Logging & Monitoring

**What to log:** failed auth attempts, permission denials, input validation failures, unexpected errors  
**What NEVER to log:** passwords, tokens, full credit card numbers, SSNs, full request bodies containing PII

```javascript
// ❌ BAD
console.log('Login attempt:', { username, password });

// ✅ GOOD
console.log('Login attempt:', { username, success: false, ip: req.ip });
```

---

## 12. Our Working Agreement

| When I write code, I commit to: | When you review code, watch for: |
|---|---|
| Using parameterized queries always | Hardcoded strings that look like secrets |
| Validating all inputs server-side | Routes with no auth middleware |
| Never hardcoding secrets | Direct use of user input in queries/commands |
| Flagging patterns I'm reproducing from context | `dangerouslySetInnerHTML` or `eval` in React |
| Adding auth checks to every data-access function | Responses that return full objects |
| Returning generic error messages to clients | Missing rate limiting on public endpoints |
| Asking you before installing new dependencies | Console logs with sensitive values |

---

## 13. Node.js Local Script Security (Moodle Sync Context)

> Added April 2026 after evaluating whether to replace the browser-based sync with a local Node.js helper script.

### Recent Vulnerabilities (March 2026 Release)

Node.js patched 9 vulnerabilities across all supported versions (20.x, 22.x, 24.x, 25.x) on March 24, 2026:

| CVE | Severity | What it does |
|-----|----------|-------------|
| CVE-2026-21637 | High | TLS SNICallback crash — uncaught exception bypasses error handlers |
| CVE-2026-21714 | High | HTTP/2 WINDOW_UPDATE memory leak — server memory exhaustion |
| CVE-2026-21717 | Medium | V8 HashDoS — predictable string hash collisions degrade performance |
| CVE-2026-21710 | Medium | `__proto__` header causes uncaught TypeError in HTTP requests |
| CVE-2025-55130 | High | Permission Model bypass via symlink path traversal |
| Multiple | Low-Med | `fs.realpathSync.native()`, `fs.futimes()`, `FileHandle.chmod()` permission bypasses |

**Key takeaway:** These are mostly DoS and Permission Model sandbox escapes — relevant to *server-side* Node.js. They are NOT "data breaches" in the traditional sense. No user data was stolen from Node.js itself.

### Risk Assessment for a Local Node.js Sync Script

If we ever build a Node.js helper to replace the browser file picker:

**What changes:**
- The browser's File System Access API sandbox goes away
- The Node.js script would have full `fs` access to the user's machine
- A bug in the script (or a compromised dependency) could read/write anywhere

**Mitigations we MUST apply:**
1. **Path confinement:** Hardcode the root write path and reject any resolved path outside it (`path.resolve()` then check it starts with the allowed prefix). Never construct paths from Moodle content without sanitization.
2. **No `exec`/`execFile`/`spawn`:** The script should never shell out. All operations via Node.js APIs only.
3. **Dependency minimization:** Use only `node:fs`, `node:path`, `node:https` (built-ins). Avoid npm packages — each one is an attack surface.
4. **ZIP extraction safety (Zip Slip):** If extracting ZIPs, validate that every extracted filename resolves inside the target directory. Never trust filenames from ZIP entries as-is.
5. **Pin Node.js version:** Use a current LTS version (22.x) with all March 2026 patches applied. Run `node --version` at script start and refuse to run on unpatched versions.
6. **No network listeners:** The script must not open any ports. It should be a run-and-exit tool, not a daemon.
7. **Credential handling:** Moodle session cookies must be passed in, never stored on disk. Prefer reading from the browser cookie jar via a Chrome extension rather than storing tokens.

**Current decision (April 2026):** We are NOT building the Node.js helper yet. The browser-based approach via Chrome extension + File System Access API is safer because the browser provides the sandbox. The tradeoff is the directory picker dialog on each run.

### Audit of Current Browser-Based Sync Engine (v2.2)

| Check | Status | Notes |
|-------|--------|-------|
| Runs in browser sandbox | PASS | File System Access API — user must grant permission per session |
| Writes only to semester folder | PASS | All writes go through `semesterHandle` which is scoped by the picker |
| No hardcoded secrets | PASS | No API keys, tokens, or passwords in the script |
| CDN script loading (SheetJS, JSZip) | ACCEPTABLE RISK | Loaded from official CDNs with version pinning. If CDN is compromised, the script could be tampered — but this runs in Moodle's origin, not a high-value target |
| ZIP extraction path traversal | PASS | `tryExtractZip()` strips directory paths, uses only the filename via `path.split('/').pop()` |
| Filename sanitization | PASS | `normalizeName()` strips Unicode control chars, illegal filename chars, and truncates at 80 chars |
| Cross-origin fetch handling | PASS | Google exports use no credentials (CORS-safe). Moodle fetches use `credentials: 'include'` (same-origin only) |
| No `eval()` on user content | PASS | `eval()` is only used to load the engine script itself (read from local filesystem by the scheduled task) — not on any Moodle content |
| Config injection via `window` global | ACCEPTABLE | Standard pattern for browser script communication. Config contains no secrets. |
| Error messages don't leak sensitive data | PASS | Errors show Moodle URLs and HTTP status codes only |

**Overall verdict: The current browser-based system is secure.** The main attack surface is the CDN-loaded libraries, which is an acceptable risk for a personal-use tool.

---

## 🔄 When to Revisit This Doc

- Before starting a new feature area
- When introducing a new third-party service or API
- Before any production deployment
- When this doc feels incomplete — add to it
- **Before building the Node.js local helper** — review Section 13 mitigations

---

*Last updated: April 2026 | Maintained by: Ido & Claude*
