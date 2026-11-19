// Backward-compatible entrypoint for `eval:voice` and `eval:all`.
// The old context-free voice heuristic required invented first-person experience
// and merely logged failures. Behavioral evaluation now uses authored source
// evidence, a strict call budget and explicit semantic review. Live calls require
// BEHAVIORAL_EVAL_RUN=1 plus an explicit model and maximum call count.
import './behavioral/evaluation.test'
import './behavioral/runConsistency'
