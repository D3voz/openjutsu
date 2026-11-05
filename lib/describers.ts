export const SUGGESTIONS = [
  { name: "qwen3vl_8b_int8_convrot.safetensors", label: "Qwen3-VL 8B · INT8", size: "9.35 GB", note: "Openjutsu default", url: "https://huggingface.co/Comfy-Org/Qwen3-VL/blob/main/text_encoders/qwen3vl_8b_int8_convrot.safetensors" },
  { name: "qwen3vl_4b_fp8_scaled.safetensors", label: "Qwen3-VL 4B · FP8", size: "5.24 GB", note: "Smaller Qwen alternative", url: "https://huggingface.co/Comfy-Org/Qwen3-VL/blob/main/text_encoders/qwen3vl_4b_fp8_scaled.safetensors" },
  { name: "gemma4_e2b_it_int8_convrot.safetensors", label: "Gemma 4 E2B · INT8", size: "5.2 GB", note: "Smaller vision alternative", url: "https://huggingface.co/Comfy-Org/gemma-4/blob/main/text_encoders/gemma4_e2b_it_int8_convrot.safetensors" },
];

// Browser download link for a suggested model.
export const downloadUrl = (url: string) => url.replace("/blob/", "/resolve/") + "?download=true";
