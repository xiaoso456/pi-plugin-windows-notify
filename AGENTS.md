# Agent Guidelines

## After modifying any `.ts` file

Run TypeScript type check to verify correctness:

```
npx tsc src/index.ts --noEmit --skipLibCheck
```

If TypeScript is not installed, install it first:

```
npm install -D typescript && npx tsc src/index.ts --noEmit --skipLibCheck
```

Do not report changes as complete until the type check passes with zero errors.
