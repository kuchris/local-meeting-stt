export const postKinds = [
  "cpp-cpu",
  "cpp-gpu",
  "cpp-vulkan",
  "cpp-npu",
  "cpp-openvino-gpu",
  "qwen-cpu",
  "qwen-gpu",
] as const;
export function isPostKind(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (postKinds as readonly string[]).includes(value)
  );
}
export function switchPostModel(current: string, model: string): string {
  const cuda = current === "cpp-gpu" || current === "qwen-gpu";
  return `${model === "qwen" ? "qwen" : "cpp"}-${cuda ? "gpu" : "cpu"}`;
}
