# Copied rules

These files are copies from Recursive Board's `src/shared/` at version 0.8.3. They hold the rules
that `wi` applies, so a verdict here makes the same edit as `wi approve` and `wi send-back`. They
import nothing but each other, and nothing from Node.

`dashboard.ts` is the exception. It was Recursive Board's dashboard model, and it now lives only
here. Change it freely.

To refresh the other files, copy them again from the same folder of a newer Recursive Board, and
run `npm test`. Keep `src/ios-safety.test.ts` passing: a single Node import stops the plugin on a
phone.
