import path from "node:path";
import sharp from "sharp";

const sourcePath = path.resolve("build/icon.svg");
const targetPath = path.resolve("build/icon.png");
await sharp(sourcePath).resize(1024, 1024).png().toFile(targetPath);
