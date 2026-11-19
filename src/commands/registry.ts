import add from "./add";
import check from "./check";
import curl from "./curl";
import doctor from "./doctor";
import environment from "./env";
import init from "./init";
import ls from "./ls";
import migrate from "./migrate";
import open from "./open";
import rm from "./rm";
import status from "./status";
import sync from "./sync";
import variable from "./var";
import wait from "./wait";

/** Every command but `completion`, which is built from this list. */
export const commands = {
  init,
  add,
  rm,
  ls,
  check,
  wait,
  open,
  curl,
  var: variable,
  env: environment,
  status,
  doctor,
  sync,
  migrate,
};
