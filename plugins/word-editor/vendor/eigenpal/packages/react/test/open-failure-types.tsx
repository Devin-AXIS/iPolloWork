// Compile-time checks for `useOpenFailure().dismiss`: a click handler and a failure both type.
// Listed in tsconfig.json `include`, so `bun run typecheck` fails if either stops compiling.
import { useOpenFailure } from '../src/editor/DocxEditorOpenFailure.tsx';

export function OpenFailureTypesProbe() {
  const { failure, dismiss } = useOpenFailure();
  return (
    <>
      <button type="button" onClick={dismiss} />
      <button type="button" onClick={() => dismiss(failure ?? undefined)} />
    </>
  );
}
