"""Erzeugt die Soundeffekte (Funkrauschen, Radar-Piepen, Glitch ...). Aufruf: python3 scripts/make-sounds.py

Alle Sounds sind hier synthetisch erzeugt, also eigene Werke ohne fremde Lizenzen.
"""
import math
import random
import struct
import wave
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "assets" / "sounds"
RATE = 22050
random.seed(7)  # Gleiche Sounds bei jedem Lauf


def silence(sec):
    return [0.0] * int(sec * RATE)


def tone(freq, sec, vol=0.5, attack=0.005, decay=None, shape="sine", freq_end=None):
    """Ein Ton mit kurzem Anstieg und (optional exponentiellem) Abklingen."""
    n = int(sec * RATE)
    out = []
    phase = 0.0
    for i in range(n):
        t = i / RATE
        f = freq if freq_end is None else freq + (freq_end - freq) * (i / n)
        phase += 2 * math.pi * f / RATE
        if shape == "square":
            v = 1.0 if math.sin(phase) >= 0 else -1.0
            v *= 0.35
        elif shape == "triangle":
            v = 2 / math.pi * math.asin(math.sin(phase))
        else:
            v = math.sin(phase) + 0.18 * math.sin(2 * phase)
        env = min(1.0, t / attack) if attack > 0 else 1.0
        if decay:
            env *= math.exp(-t / decay)
        else:
            env *= min(1.0, (sec - t) / 0.02)  # weiches Ende
        out.append(v * env * vol)
    return out


def noise(sec, vol=0.3, lowpass=0.25, highpass=0.97, fade=0.03):
    """Bandbegrenztes Rauschen wie bei einem Funkgerät."""
    n = int(sec * RATE)
    out = []
    lp = 0.0
    hp_prev_in = 0.0
    hp_prev_out = 0.0
    for i in range(n):
        x = random.uniform(-1, 1)
        lp += lowpass * (x - lp)
        y = highpass * (hp_prev_out + lp - hp_prev_in)
        hp_prev_in, hp_prev_out = lp, y
        t = i / RATE
        env = min(1.0, t / fade, (sec - t) / fade)
        # leichtes Flattern der Lautstärke
        env *= 0.75 + 0.25 * math.sin(2 * math.pi * 23 * t)
        out.append(y * env * vol * 3)
    return out


def mix(*tracks):
    n = max(len(t) for t in tracks)
    return [sum(t[i] for t in tracks if i < len(t)) for i in range(n)]


def at(sec, track):
    return silence(sec) + track


def write(name, samples):
    OUT.mkdir(parents=True, exist_ok=True)
    peak = max(1e-9, max(abs(s) for s in samples))
    gain = min(1.0, 0.89 / peak)
    with wave.open(str(OUT / name), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, s * gain)) * 32767)) for s in samples))
    print(f"{name}: {len(samples) / RATE:.2f} s")


# Ping: kurzes Funkrauschen, dann ein Radar-Piepen mit Echo.
write(
    "ping.wav",
    mix(
        noise(0.22, vol=0.25),
        at(0.18, tone(1250, 0.5, vol=0.55, decay=0.12)),
        at(0.42, tone(1250, 0.35, vol=0.18, decay=0.1)),
    ),
)

# Alarm: zwei Töne im Wechsel, gut hörbar draußen.
alarm = []
for k in range(4):
    alarm += tone(880 if k % 2 == 0 else 660, 0.14, vol=0.45, shape="square") + silence(0.03)
write("alarm.wav", alarm)

# Glitch: zerhackte, springende Töne (Störsender, Fake-Ping).
glitch = []
for k in range(9):
    f = random.choice([220, 330, 440, 660, 990, 1320])
    glitch += tone(f, random.uniform(0.02, 0.05), vol=0.4, shape="square", attack=0.001)
    if random.random() < 0.5:
        glitch += noise(random.uniform(0.01, 0.03), vol=0.35, fade=0.003)
write("glitch.wav", glitch + tone(180, 0.12, vol=0.35, shape="square", freq_end=90))

# Erfolg: aufsteigender Dreiklang (neue Fähigkeit).
write(
    "success.wav",
    mix(
        tone(660, 0.16, vol=0.4, shape="triangle"),
        at(0.1, tone(880, 0.16, vol=0.4, shape="triangle")),
        at(0.2, tone(1320, 0.3, vol=0.4, shape="triangle", decay=0.12)),
    ),
)

# Toter Briefkasten: zwei weiche Glockentöne.
write(
    "checkpoint.wav",
    mix(
        tone(988, 0.5, vol=0.4, decay=0.18),
        at(0.16, tone(1480, 0.6, vol=0.35, decay=0.22)),
    ),
)
