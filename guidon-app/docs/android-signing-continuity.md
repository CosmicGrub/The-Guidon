# Android release-signing continuity

GUIDON Android updates must remain signed by the established release identity. This document records the **public certificate identity only**; private key material and keystore passwords must never be committed.

## Canonical signer

The canonical signer was independently recovered from the owner-supplied pre-work `GUIDON-1.4.7-release.apk` and cross-checked against the newest pre-work Android release pair, `v1.9.0`.

- Subject: `CN=GUIDON, OU=Leader Development, O=GUIDON, C=US`
- Key: RSA 4096-bit
- SHA-256 certificate fingerprint: `83:A0:CA:E6:88:A7:14:AA:00:80:22:D9:AB:8B:E5:84:0D:32:7C:7B:0F:6E:67:3E:42:6F:E1:13:ED:1E:1D:A2`
- Normalized fingerprint used by CI: `83a0cae688a714aa008022d9ab8be5840d327c7b0f6e673e426fe113ed1e1da2`

The following pre-work artifacts were verified to carry that exact same signer certificate:

1. `GUIDON-1.4.7-release.apk`
2. `GUIDON-1.9.0-android.apk`
3. `GUIDON-1.9.0-android.aab`

The `v1.10.0` GitHub Release contains no Android APK/AAB, so `v1.9.0` is the newest pre-work Android pair available for continuity verification.

## Enforcement

`.github/workflows/android-signing-audit.yml` downloads the `v1.9.0` APK and AAB and verifies both against the canonical fingerprint above.

`.github/workflows/release-assets.yml` reconstructs the existing release keystore from GitHub Actions secrets, builds the release APK and AAB, verifies both package signatures, extracts both signer certificates, and refuses publication unless:

- the APK signer equals the canonical GUIDON fingerprint;
- the AAB signer equals the canonical GUIDON fingerprint; and
- the APK and AAB signer fingerprints equal each other.

The GUIDON release certificate is intentionally self-signed. The AAB verifier therefore checks JAR signature integrity and then pins the exact signer certificate instead of treating public-CA trust as an Android update-signing requirement.

## Private-key rule

An APK or AAB contains the public signing certificate, **not the private signing key**. These artifacts can prove which key identity must be used, but they cannot recreate the private key. The established `keys/guidon-release.jks` (or the equivalent keystore reconstructed from Actions secrets) must contain the private key corresponding to the certificate above. A mismatched keystore must fail the release rather than create an update-incompatible Android build.
