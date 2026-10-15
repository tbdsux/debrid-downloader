// Cottontail's fetch connects via node:net with Happy Eyeballs, giving each
// resolved address only 250ms (Node's default). Hosts with a slower TCP
// handshake (e.g. api.real-debrid.com at ~350ms) then fail every address with
// "ETIMEDOUT: All connection attempts failed" — even though curl/Bun connect
// fine. Give each attempt more time; Happy Eyeballs still falls through to the
// next address (e.g. IPv4 when IPv6 is unroutable). Import this first.
import net from "node:net";

const ATTEMPT_TIMEOUT_MS = 2500;

try {
	net.setDefaultAutoSelectFamilyAttemptTimeout(ATTEMPT_TIMEOUT_MS);
} catch (err) {
	console.warn("[net] could not raise connect attempt timeout:", err);
}
