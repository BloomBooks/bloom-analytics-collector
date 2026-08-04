import { describe, expect, it } from "vitest";
import { parseInstallerKey } from "./bloomInstallers.js";

const parse = (key: string) => parseInstallerKey(key, "2025-10-01");

describe("parseInstallerKey", () => {
    it("accepts the modern naming and extracts the version", () => {
        const entry = parse("installers/BloomInstaller.6.1.11.exe");
        expect(entry).not.toBeNull();
        expect(entry!.version).toBe("6.1.11");
        expect(entry!.date).toBe("2025-10-01");
    });

    it("accepts an architecture-suffixed installer (6.3 onwards)", () => {
        expect(parse("installers/BloomInstaller.6.3.0.x64.exe")?.version).toBe(
            "6.3.0"
        );
    });

    it("accepts the stray double-dot form seen in the bucket", () => {
        expect(parse("installers/BloomInstaller.5.4.11..exe")?.version).toBe(
            "5.4.11"
        );
    });

    it("accepts legacy Release-channel and pre-channel msi names", () => {
        expect(
            parse("installers/BloomInstaller.3.0.100.Release.msi")?.version
        ).toBe("3.0.100");
        expect(parse("installers/BloomInstaller.2.0.2000.msi")?.version).toBe(
            "2.0.2000"
        );
    });

    it("rejects non-Release channels, which must not inflate the count", () => {
        expect(parse("installers/BloomInstaller.3.9.100.Beta.msi")).toBeNull();
        expect(parse("installers/BloomInstaller.3.9.100.beta.msi")).toBeNull();
        expect(parse("installers/BloomInstaller.3.9.100.alpha.msi")).toBeNull();
        expect(parse("installers/BloomInstaller.3.9.100.ACR.msi")).toBeNull();
    });

    it("rejects other products and non-installer keys", () => {
        expect(
            parse("installers/Reading-App-Builder-For-Bloom-6-4-Setup.exe")
        ).toBeNull();
        expect(parse("installers/")).toBeNull();
        expect(parse("some-other-prefix/BloomInstaller.6.1.11.exe")).toBeNull();
    });

    it("rejects archived and other-platform subfolders", () => {
        expect(parse("installers/old/BloomInstaller.1.0.30.msi")).toBeNull();
        expect(parse("installers/linux/whatever.deb")).toBeNull();
    });
});
