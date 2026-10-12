import { describe, expect, it } from "vitest";
import { scoreAnswer, type ScorableQuestion } from "../src/scoring.js";

/**
 * За сваки тип задатка три случаја: тачан, нетачан и ивични.
 * Нови тип не иде у продукцију без сва три.
 */

const q = (type: ScorableQuestion["type"], correct: unknown, points = 1): ScorableQuestion => ({
  type,
  correct,
  points,
});

describe("single — обој кружић испред тачног одговора", () => {
  const question = q("single", 1);
  it("тачан", () => expect(scoreAnswer(question, 1)).toEqual({ isCorrect: true, points: 1 }));
  it("нетачан", () => expect(scoreAnswer(question, 0)).toEqual({ isCorrect: false, points: 0 }));
  it("ивично: празан, стринг, ван опсега", () => {
    expect(scoreAnswer(question, null).isCorrect).toBe(false);
    expect(scoreAnswer(question, "1").isCorrect).toBe(false);
    expect(scoreAnswer(question, 1.5).isCorrect).toBe(false);
    expect(scoreAnswer(question, undefined).isCorrect).toBe(false);
  });
});

describe("multi — више тачних одговора", () => {
  const question = q("multi", [1, 2, 3]);
  it("тачан, у било ком редоследу", () => {
    expect(scoreAnswer(question, [3, 1, 2]).isCorrect).toBe(true);
  });
  it("нетачан: једна погрешна ставка", () => {
    expect(scoreAnswer(question, [0, 1, 2]).isCorrect).toBe(false);
  });
  it("ивично: делимично, вишак, понављање, празно", () => {
    expect(scoreAnswer(question, [1, 2]).isCorrect).toBe(false);
    expect(scoreAnswer(question, [0, 1, 2, 3]).isCorrect).toBe(false);
    // Иста ставка двапут не сме да замени ставку која недостаје.
    expect(scoreAnswer(question, [1, 1, 2]).isCorrect).toBe(false);
    expect(scoreAnswer(question, []).isCorrect).toBe(false);
    expect(scoreAnswer(question, "1,2,3").isCorrect).toBe(false);
  });
});

describe("text — упиши одговор", () => {
  const question = q("text", [["праисторија"], ["историја"]]);
  it("тачан", () => expect(scoreAnswer(question, ["праисторија", "историја"]).isCorrect).toBe(true));
  it("нетачан", () => expect(scoreAnswer(question, ["историја", "праисторија"]).isCorrect).toBe(false));
  it("ивично: латиница, велика слова, размаци, празно поље, погрешан број поља", () => {
    expect(scoreAnswer(question, ["  Praistorija ", "ISTORIJA."]).isCorrect).toBe(true);
    expect(scoreAnswer(question, ["праисторија", ""]).isCorrect).toBe(false);
    expect(scoreAnswer(question, ["праисторија"]).isCorrect).toBe(false);
    expect(scoreAnswer(question, "праисторија").isCorrect).toBe(false);
  });
  it("ивично: више прихватљивих облика у истом пољу", () => {
    const variants = q("text", [["Англи и Саси", "Саси и Англи", "Англи, Саси"]]);
    expect(scoreAnswer(variants, ["Sasi i Angli"]).isCorrect).toBe(true);
    expect(scoreAnswer(variants, ["Англи и Франци"]).isCorrect).toBe(false);
  });
});

describe("matching — обој кружић у одговарајућем пољу табеле", () => {
  const question = q("matching", [2, 3, 1, 0]);
  it("тачан", () => expect(scoreAnswer(question, [2, 3, 1, 0]).isCorrect).toBe(true));
  it("нетачан: један ред погрешан", () => {
    expect(scoreAnswer(question, [2, 3, 0, 0]).isCorrect).toBe(false);
  });
  it("ивично: празан ред, краћи одговор, исти ступац у више редова", () => {
    expect(scoreAnswer(question, [2, 3, null, 0]).isCorrect).toBe(false);
    expect(scoreAnswer(question, [2, 3, 1]).isCorrect).toBe(false);
    const repeated = q("matching", [1, 1, 0]);
    expect(scoreAnswer(repeated, [1, 1, 0]).isCorrect).toBe(true);
  });
});

describe("ordering — поређај хронолошки", () => {
  const question = q("ordering", [2, 0, 3, 1]);
  it("тачан", () => expect(scoreAnswer(question, [2, 0, 3, 1]).isCorrect).toBe(true));
  it("нетачан: две ставке замењене", () => {
    expect(scoreAnswer(question, [0, 2, 3, 1]).isCorrect).toBe(false);
  });
  it("ивично: ставка двапут, недостаје ставка, неизмењен редослед", () => {
    expect(scoreAnswer(question, [2, 2, 3, 1]).isCorrect).toBe(false);
    expect(scoreAnswer(question, [2, 0, 3]).isCorrect).toBe(false);
    // Ученик који ништа не помери шаље приказани редослед 0,1,2,3.
    expect(scoreAnswer(question, [0, 1, 2, 3]).isCorrect).toBe(false);
  });
});

/**
 * Делимични бодови из „Упутства за прегледање“ завршног испита: „Три тачна
 * одговора и ниједан нетачан – 1 бод; Два тачна одговора и ниједан нетачан –
 * 0,5 бодова“. Празан ред није нетачан одговор; погрешно обојен јесте.
 */
describe("matching — делимични бодови по упутству за прегледање", () => {
  const question: ScorableQuestion = {
    type: "matching",
    correct: [2, 0, 1],
    points: 1,
    partial: [{ correct: 2, points: 0.5 }],
  };

  it("тачан: сва три реда — пун бод", () => {
    expect(scoreAnswer(question, [2, 0, 1])).toEqual({ isCorrect: true, points: 1 });
  });

  it("нетачан: два тачна и један нетачан — 0 бодова", () => {
    expect(scoreAnswer(question, [2, 0, 2])).toEqual({ isCorrect: false, points: 0 });
  });

  it("ивично: два тачна и један празан — 0,5; један тачан — 0", () => {
    expect(scoreAnswer(question, [2, 0, null])).toEqual({ isCorrect: false, points: 0.5 });
    expect(scoreAnswer(question, [null, 0, 1])).toEqual({ isCorrect: false, points: 0.5 });
    expect(scoreAnswer(question, [2, null, null])).toEqual({ isCorrect: false, points: 0 });
    expect(scoreAnswer(question, [null, null, null])).toEqual({ isCorrect: false, points: 0 });
  });

  it("ивично: табела са четири реда — три тачна и ниједан нетачан", () => {
    const four: ScorableQuestion = {
      type: "matching",
      correct: [3, 1, 2, 0],
      points: 1,
      partial: [{ correct: 3, points: 0.5 }],
    };
    expect(scoreAnswer(four, [3, 1, 2, null]).points).toBe(0.5);
    expect(scoreAnswer(four, [3, 1, null, null]).points).toBe(0);
    expect(scoreAnswer(four, [3, 1, 2, 1]).points).toBe(0);
  });

  it("ивично: без правила нема делимичних бодова, а неисправно правило се не примењује", () => {
    expect(scoreAnswer({ ...question, partial: undefined }, [2, 0, null]).points).toBe(0);
    expect(scoreAnswer({ ...question, partial: "пола" }, [2, 0, null]).points).toBe(0);
    // Правило које би дало колико и тачан одговор (или више) није делимично.
    expect(scoreAnswer({ ...question, partial: [{ correct: 2, points: 1 }] }, [2, 0, null]).points).toBe(0);
    // Одговор погрешне дужине се не бодује ни делимично.
    expect(scoreAnswer(question, [2, 0]).points).toBe(0);
  });
});

describe("поени и непознат тип", () => {
  it("тачан одговор носи поене задатка", () => {
    expect(scoreAnswer(q("single", 0, 2), 0)).toEqual({ isCorrect: true, points: 2 });
  });
  it("непознат тип се не бодује", () => {
    expect(scoreAnswer({ type: "essay" as never, correct: "x", points: 1 }, "x").isCorrect).toBe(false);
  });
  it("оштећен кључ у бази не прави тачан одговор", () => {
    expect(scoreAnswer(q("multi", null), []).isCorrect).toBe(false);
    expect(scoreAnswer(q("text", "праисторија"), ["праисторија"]).isCorrect).toBe(false);
  });
});
