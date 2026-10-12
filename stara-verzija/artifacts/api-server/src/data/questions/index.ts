import type { Question } from "../types";
import { zadaci241to260 } from "./zadaci-241-260";
import { zadaci261to280 } from "./zadaci-261-280";
import { zadaci281to300 } from "./zadaci-281-300";
import { zadaci301to320 } from "./zadaci-301-320";
import { zadaci321to340 } from "./zadaci-321-340";
import { zadaci341to360 } from "./zadaci-341-360";

// Редослед прати збирку: задаци 241–360, део ИСТОРИЈА.
export const questions: Question[] = [
  ...zadaci241to260,
  ...zadaci261to280,
  ...zadaci281to300,
  ...zadaci301to320,
  ...zadaci321to340,
  ...zadaci341to360,
];

const byId = new Map(questions.map((q) => [q.id, q]));

/**
 * Задатак се тражи по броју, никад по позицији у низу.
 * Позиција се мења при сваком допуњавању збирке, а број задатка је оно што је
 * уписано у већ сачуваним покушајима — тражење по позицији би им променило
 * значење уназад.
 */
export const questionById = (id: number): Question | undefined => byId.get(id);

export type { Question };
