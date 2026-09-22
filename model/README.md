# Local classifier

The current classifier is deterministic and lives in `packages/domain/src/classification.ts`; taxonomy, aliases and Italian labels are separate domain modules. Explicit personal-account routes identify transfers without a category; lexical rules classify expense/income categories. Unknown or conflicting descriptions remain unconfirmed, without a generic fallback category.

No model is implemented or trained in this directory. In a future phase, a small local classifier may run after unknown rule results, using the same type/category taxonomy documented in the root README. Its integration can extend `ClassificationSource` with `model`. Amount, date and account remain the deterministic parser's responsibility. No external AI APIs are used.

Only reviewed synthetic examples and safe training code may be committed. No personal messages or financial data are collected or saved by this version.

Real transactions and private phrases must remain outside the repository under `model/data/private/`, which is ignored by Git.
