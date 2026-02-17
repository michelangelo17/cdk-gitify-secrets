#!/usr/bin/env python3
"""
secret-review CLI

Usage:
    sr propose  --project X --env Y --reason "..." [--file .env]
    sr pull     --project X --env Y [--output .env]
    sr history  --project X --env Y
    sr status   [--change-id ID]
    sr configure --api-url URL --token TOKEN
"""

import argparse
import json
import os
import sys
from pathlib import Path

try:
    import requests
except ImportError:
    print("Install requests: pip install requests")
    sys.exit(1)

CONFIG_DIR = Path.home() / ".secret-review"
CONFIG_FILE = CONFIG_DIR / "config.json"


def load_config():
    if not CONFIG_FILE.exists():
        print("Not configured. Run: sr configure --api-url <URL> --token <COGNITO_TOKEN>")
        sys.exit(1)
    with open(CONFIG_FILE) as f:
        return json.load(f)


def save_config(data):
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_FILE, "w") as f:
        json.dump(data, f, indent=2)
    os.chmod(CONFIG_FILE, 0o600)


def api_request(method, path, body=None):
    cfg = load_config()
    url = cfg["api_url"].rstrip("/") + path
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {cfg['token']}",
    }
    resp = requests.request(method, url, headers=headers, json=body, timeout=30)

    if resp.status_code == 401:
        print("❌ Authentication expired. Run: sr configure --token <NEW_TOKEN>")
        sys.exit(1)

    return resp.json()


def parse_env_file(filepath):
    """Parse a .env file into a dict. Handles comments, blank lines, quotes."""
    variables = {}
    with open(filepath) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip()
            # Strip surrounding quotes
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
                value = value[1:-1]
            variables[key] = value
    return variables


def write_env_file(variables, filepath):
    """Write a dict as a .env file."""
    with open(filepath, "w") as f:
        for key in sorted(variables.keys()):
            value = variables[key]
            # Quote values with spaces or special chars
            if " " in value or '"' in value or "'" in value or "#" in value:
                value = f'"{value}"'
            f.write(f"{key}={value}\n")


# ── Commands ───────────────────────────────────────

def cmd_configure(args):
    config = {}
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE) as f:
            config = json.load(f)

    if args.api_url:
        config["api_url"] = args.api_url
    if args.token:
        config["token"] = args.token

    save_config(config)
    print(f"✅ Config saved to {CONFIG_FILE}")


def cmd_propose(args):
    env_file = args.file or ".env"

    if not Path(env_file).exists():
        print(f"❌ File not found: {env_file}")
        sys.exit(1)

    variables = parse_env_file(env_file)

    if not variables:
        print("⚠️  No variables found in the file.")
        sys.exit(1)

    print(f"📤 Proposing {len(variables)} variable(s) for {args.project}/{args.env}")
    print(f"   Reason: {args.reason}")
    print()

    data = api_request("POST", "/changes", {
        "project": args.project,
        "env": args.env,
        "variables": variables,
        "reason": args.reason,
    })

    if data.get("changeId"):
        print(f"✅ Change proposed: {data['changeId']}")
        print()
        diff = data.get("diff", [])
        if diff:
            print("  Changes detected:")
            for d in diff:
                sym = {"added": "+", "removed": "-", "modified": "~"}.get(d["type"], "?")
                print(f"    {sym} {d['key']}")
        print()
        print("  ⏳ Waiting for approval in the review dashboard.")
    elif data.get("message") == "No changes detected":
        print("✅ No changes detected. Everything is up to date.")
    else:
        print(f"❌ {data.get('error', 'Unknown error')}")


def cmd_pull(args):
    cfg = load_config()
    url = cfg["api_url"].rstrip("/") + f"/history/{args.project}/{args.env}"
    headers = {"Authorization": f"Bearer {cfg['token']}"}

    resp = requests.get(url, headers=headers, timeout=30)
    data = resp.json()

    # The current values aren't exposed via history (keys only).
    # We need to get the latest approved change's proposedVariables.
    # In a full implementation, add a GET /secrets/{project}/{env} endpoint.
    # For now, inform the user.
    current_keys = data.get("currentKeys", [])

    if current_keys:
        print(f"🔑 Current variables in {args.project}/{args.env}:")
        for key in current_keys:
            print(f"   {key}")
        print()
        print(f"   Total: {len(current_keys)} variable(s)")
        print()
        print("💡 To get actual values, use the review dashboard with reveal enabled,")
        print("   or add a /secrets endpoint for CLI pull support.")
    else:
        print(f"📭 No variables found for {args.project}/{args.env}")


def cmd_history(args):
    data = api_request("GET", f"/history/{args.project}/{args.env}")

    history = data.get("history", [])
    if not history:
        print(f"📭 No history for {args.project}/{args.env}")
        return

    print(f"📜 History for {args.project}/{args.env}")
    print(f"   {'ID':<14} {'Status':<10} {'By':<25} {'Reason'}")
    print(f"   {'─'*14} {'─'*10} {'─'*25} {'─'*30}")

    for h in history:
        cid = h.get("changeId", "?")[:12]
        status = h.get("status", "?")
        by = h.get("proposedBy", "?")[:24]
        reason = h.get("reason", "")[:40]
        print(f"   {cid:<14} {status:<10} {by:<25} {reason}")


def cmd_status(args):
    if args.change_id:
        data = api_request("GET", f"/changes/{args.change_id}/diff")
        if data.get("error"):
            print(f"❌ {data['error']}")
            return
        print(f"Change: {data.get('changeId')}")
        print(f"Status: {data.get('status')}")
        print(f"Project: {data.get('project')}/{data.get('env')}")
        print(f"By: {data.get('proposedBy')}")
        print(f"Reason: {data.get('reason')}")
    else:
        data = api_request("GET", "/changes?status=pending")
        changes = data.get("changes", [])
        if not changes:
            print("✅ No pending changes")
            return
        print(f"⏳ {len(changes)} pending change(s):")
        for c in changes:
            print(f"   {c['changeId'][:12]}  {c['project']}/{c['env']}  {c.get('reason','')[:40]}")


# ── Main ───────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        prog="sr",
        description="Secret Review CLI — propose, review, and manage environment secrets",
    )
    sub = parser.add_subparsers(dest="command")

    # configure
    p_conf = sub.add_parser("configure", help="Set API URL and auth token")
    p_conf.add_argument("--api-url", help="Secret Review API URL")
    p_conf.add_argument("--token", help="Cognito auth token")

    # propose
    p_prop = sub.add_parser("propose", help="Propose a change from a .env file")
    p_prop.add_argument("-p", "--project", required=True)
    p_prop.add_argument("-e", "--env", required=True)
    p_prop.add_argument("-r", "--reason", required=True)
    p_prop.add_argument("-f", "--file", default=".env", help="Path to .env file (default: .env)")

    # pull
    p_pull = sub.add_parser("pull", help="View current variables for a project/env")
    p_pull.add_argument("-p", "--project", required=True)
    p_pull.add_argument("-e", "--env", required=True)
    p_pull.add_argument("-o", "--output", help="Write to file")

    # history
    p_hist = sub.add_parser("history", help="View change history")
    p_hist.add_argument("-p", "--project", required=True)
    p_hist.add_argument("-e", "--env", required=True)

    # status
    p_stat = sub.add_parser("status", help="Check pending changes or a specific change")
    p_stat.add_argument("--change-id", help="Specific change ID to inspect")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(0)

    commands = {
        "configure": cmd_configure,
        "propose": cmd_propose,
        "pull": cmd_pull,
        "history": cmd_history,
        "status": cmd_status,
    }

    commands[args.command](args)


if __name__ == "__main__":
    main()
