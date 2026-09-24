import http from "node:http";
import net from "node:net";
import path from "node:path";
import { execSync } from "node:child_process";

/**
 * Checks if a TCP port is currently accepting connections on the given host.
 */
export function isPortInUse(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(400);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

/**
 * Waits up to `timeoutMs` for a port to become free (no longer accepting connections).
 */
export async function waitForPortFree(
  port: number,
  timeoutMs = 2500,
  host = "127.0.0.1",
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const inUse = await isPortInUse(port, host);
    if (!inUse) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return !(await isPortInUse(port, host));
}

/**
 * Sends a loopback HTTP POST request to gracefully ask the running server to shut down.
 */
export function requestGracefulShutdown(port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/system/shutdown",
        method: "POST",
        timeout: timeoutMs,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

/**
 * Finds the PID listening on a given port on Windows via `netstat -ano -p tcp`.
 */
export function findPidListeningOnPort(port: number): number | null {
  if (process.platform !== "win32") return null;
  try {
    const stdout = execSync("netstat -ano -p tcp", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    for (const line of stdout.split(/\r?\n/)) {
      if (line.includes(`:${port}`) && line.includes("LISTENING")) {
        const parts = line.trim().split(/\s+/);
        const pidStr = parts[parts.length - 1];
        const pid = Number(pidStr);
        if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) {
          return pid;
        }
      }
    }
  } catch {
    // command failed or not available
  }
  return null;
}

/**
 * Finds other running PIDs of a given executable name on Windows via `tasklist`.
 */
export function findOtherExePids(exeName: string): number[] {
  if (process.platform !== "win32") return [];
  const pids: number[] = [];
  const target = exeName.toLowerCase();
  try {
    const stdout = execSync("tasklist /FO CSV /NH", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    for (const rawLine of stdout.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const parts = line.split('","');
      if (parts.length >= 2) {
        const name = parts[0].replace(/^"/, "").toLowerCase();
        const pid = Number(parts[1].replace(/"/g, ""));
        if (name === target && pid !== process.pid && Number.isInteger(pid) && pid > 0) {
          pids.push(pid);
        }
      }
    }
  } catch {
    // command failed or not available
  }
  return pids;
}

/**
 * Terminates a process by PID. Uses `taskkill /F /T` on Windows for full process tree kill.
 */
export function killProcess(pid: number, force = true): boolean {
  if (pid <= 0 || pid === process.pid) return false;
  if (process.platform === "win32") {
    try {
      execSync(`taskkill ${force ? "/F /T " : ""}/PID ${pid}`, {
        stdio: ["ignore", "ignore", "ignore"],
      });
      return true;
    } catch {
      try {
        process.kill(pid, force ? "SIGKILL" : "SIGTERM");
        return true;
      } catch {
        return false;
      }
    }
  } else {
    try {
      process.kill(pid, force ? "SIGKILL" : "SIGTERM");
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Ensures this process is the single active instance:
 * 1. Checks if the port is in use or other instances of the executable are running.
 * 2. Attempts a graceful HTTP shutdown.
 * 3. Forcefully terminates any remaining instances and process on the port.
 * 4. Waits until the port is released so this instance can bind and start cleanly.
 */
export async function ensureSingleActiveInstance(options: {
  port: number;
  exeName?: string;
  log?: (msg: string) => void;
}): Promise<boolean> {
  const log = options.log ?? (() => {});
  const port = options.port;
  const exeName =
    options.exeName ?? (process.platform === "win32" ? path.basename(process.execPath) : undefined);

  const portInUse = await isPortInUse(port);
  const otherPids = exeName ? findOtherExePids(exeName) : [];

  if (!portInUse && otherPids.length === 0) {
    return false;
  }

  log(
    `previous instance detected (port ${port} in use: ${portInUse}, old PIDs: ${otherPids.join(",") || "none"}). Terminating old instance to take over...`,
  );

  // 1. Try graceful shutdown if port responds
  if (portInUse) {
    const graceful = await requestGracefulShutdown(port, 700);
    if (graceful) {
      log("sent graceful shutdown signal to previous instance");
      await new Promise((r) => setTimeout(r, 350));
    }
  }

  // 2. Terminate any other instances of the same executable
  if (exeName) {
    const remainingExePids = findOtherExePids(exeName);
    for (const pid of remainingExePids) {
      log(`terminating previous executable process (PID ${pid})...`);
      killProcess(pid, true);
    }
  }

  // 3. Force kill whatever is still occupying the port
  if (await isPortInUse(port)) {
    const listeningPid = findPidListeningOnPort(port);
    if (listeningPid && listeningPid !== process.pid) {
      log(`terminating process occupying port ${port} (PID ${listeningPid})...`);
      killProcess(listeningPid, true);
    }
  }

  // 4. Wait for the port to become free
  const freed = await waitForPortFree(port, 2500);
  if (freed) {
    log(`port ${port} successfully reclaimed for new instance.`);
  } else {
    log(`warning: port ${port} may still be busy.`);
  }

  return true;
}
