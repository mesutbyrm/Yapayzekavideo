import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup.ts"],
    // Entegrasyon testleri aynı test veritabanını kullanır → dosyalar sırayla çalışır
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
