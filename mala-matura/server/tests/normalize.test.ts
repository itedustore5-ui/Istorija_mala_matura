import { describe, expect, it } from "vitest";
import { normalizeText } from "../src/normalize.js";

describe("normalizeText", () => {
  it("латиница се пресловљава у ћирилицу", () => {
    expect(normalizeText("Imenica")).toBe(normalizeText("именица"));
    expect(normalizeText("Mesopotamija")).toBe("месопотамија");
  });

  it("диграфи lj, nj, dž и слова са квачицом", () => {
    expect(normalizeText("Ljubljana")).toBe("љубљана");
    expect(normalizeText("Njegoš")).toBe("његош");
    expect(normalizeText("džamija")).toBe("џамија");
    expect(normalizeText("Đurđevdan ćuprija")).toBe("ђурђевдан ћуприја");
  });

  it("размаци, велика слова и тачка на крају не мењају одговор", () => {
    expect(normalizeText("  Велика   Британија. ")).toBe("велика британија");
    expect(normalizeText("Тир,Сидон ,  Библос")).toBe("тир, сидон, библос");
  });

  it("ивично: цртице у распону година и римски бројеви", () => {
    expect(normalizeText("1929–1932")).toBe(normalizeText("1929-1932"));
    // Римско X куцано латиницом и ћириличко Х (исто изгледају) дају исто.
    expect(normalizeText("XIX")).toBe(normalizeText("ХIХ"));
    expect(normalizeText("")).toBe("");
  });
});
