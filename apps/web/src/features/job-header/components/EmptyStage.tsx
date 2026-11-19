/** A stage whose screen is not built yet, saying why it is empty (AIV-P1-011). */
export function EmptyStage({ message }: { message: string }) {
  return <p className="text-body text-text-2">{message}</p>;
}
