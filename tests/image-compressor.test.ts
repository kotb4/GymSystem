import { describe, it, expect } from "vitest";
import { compressMemberPhoto } from "@/utils/image-compressor";

describe("compressMemberPhoto utility", () => {
  it("safely falls back without throwing when DOM canvas/image is unavailable in node environment", async () => {
    // In node/vitest environment, document/Image may be absent or mocked
    const fakeFile = new File(["dummy content"], "avatar.png", { type: "image/png" });
    const result = await compressMemberPhoto(fakeFile, { maxDimension: 512, quality: 0.82 });
    expect(result).toBeDefined();
    expect(result.name).toBe("avatar.png");
  });

  it("handles Blob input cleanly and assigns default jpg name", async () => {
    const fakeBlob = new Blob(["blob bytes"], { type: "image/jpeg" });
    const result = await compressMemberPhoto(fakeBlob);
    expect(result).toBeDefined();
    expect(result.name).toBe("photo.jpg");
    expect(result.type).toBe("image/jpeg");
  });
});
