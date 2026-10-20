"""Which bank voice does each character get?

The studio decides (not the VoxCPM2 server) so that
  * one character = one voice, and two characters never share one while spare voices exist;
  * a member's plan is respected: Pro voices only up to what the plan allows;
  * a personal VoxCPM2 link (which has no copy of the shared bank) can be given an exact voice name.
"""

from typing import Dict, Iterable, List, Optional, Set

AUTO = 'bank:auto'
PREFIX = 'bank:'


def _char_key(seg: dict) -> str:
    return seg.get('speaker_id') or seg.get('speaker_name') or 'speaker_1'


def _gender_of(segs: List[dict]) -> str:
    return 'female' if sum(1 for s in segs if s.get('gender') == 'female') * 2 > len(segs) else 'male'


def explicit_pro_voices(segments: Iterable[dict], pro: Set[str]) -> Set[str]:
    """Pro voices the member picked by hand in this video."""
    out = set()
    for s in segments:
        v = str(s.get('voiceId') or '')
        if v.startswith(PREFIX) and v != AUTO and v[len(PREFIX):] in pro:
            out.add(v[len(PREFIX):])
    return out


def resolve_auto(segments: List[dict], bank_names: List[str], pro: Set[str], pro_limit: int) -> Dict[str, str]:
    """Give every character cast on 'bank:auto' a concrete bank voice. Mutates `segments`; returns {character: voice}.

    pro_limit: how many distinct Pro voices this video may use in total (-1 = any, 0 = none).
    """
    by_char: Dict[str, List[dict]] = {}
    order: List[str] = []
    for seg in segments:
        k = _char_key(seg)
        if k not in by_char:
            by_char[k] = []
            order.append(k)
        by_char[k].append(seg)

    def is_auto(k: str) -> bool:
        return all(str(s.get('voiceId') or AUTO) == AUTO for s in by_char[k])

    taken: Set[str] = {str(s.get('voiceId'))[len(PREFIX):] for s in segments
                       if str(s.get('voiceId') or '').startswith(PREFIX) and s.get('voiceId') != AUTO}
    pro_used = len([v for v in taken if v in pro])
    names = [n for n in bank_names if n.startswith(('male', 'female'))]
    chosen: Dict[str, str] = {}
    counters = {'male': 0, 'female': 0}

    for k in order:
        if not is_auto(k):
            continue
        gender = _gender_of(by_char[k])
        pool = [n for n in names if n.startswith(gender)]
        if not pool:
            continue  # leave 'bank:auto': the VoxCPM2 server will pick
        free = [n for n in pool if n not in taken]
        pro_ok = pro_limit < 0 or pro_used < pro_limit
        # Entitled members get the clearest (Pro) voices first; everyone gets standard voices otherwise
        ranked = sorted(free, key=lambda n: (0 if (n in pro and pro_ok) else 1, 1 if (n in pro and not pro_ok) else 0, n))
        ranked = [n for n in ranked if not (n in pro and not pro_ok)]
        if ranked:
            voice = ranked[0]
        else:
            std = [n for n in pool if n not in pro or pro_ok] or pool
            voice = std[counters[gender] % len(std)]  # more characters than voices: reuse, round-robin
            counters[gender] += 1
        if voice in pro and voice not in taken:
            pro_used += 1
        taken.add(voice)
        chosen[k] = voice
        for seg in by_char[k]:
            seg['voiceId'] = PREFIX + voice
    return chosen
