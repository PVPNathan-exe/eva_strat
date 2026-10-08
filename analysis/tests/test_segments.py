import segments


def clock(start_value, t_start, t_end, countdown_from=0.0, step=1.0):
    """Lectures synthétiques : chrono figé avant t_start, puis -1 par seconde."""
    out, t = [], countdown_from
    while t <= t_end:
        out.append((t, start_value if t < t_start else max(0, start_value - int(t - t_start) - 1)))
        t += step
    return out


def test_game_starts_when_clock_leaves_its_start_value():
    games = segments.detect_games(clock(720, 10, 100), duration=100)  # carte en 12:00
    assert len(games) == 1
    assert 5 <= games[0]["start_s"] <= 8  # départ ~10 s moins la marge de compte à rebours
    assert games[0]["end_s"] == 100


def test_short_game_is_found():
    games = segments.detect_games(clock(300, 5, 80), duration=200)
    assert len(games) == 1 and games[0]["start_s"] < 5


def test_clock_jumping_back_starts_a_new_game():
    samples = clock(600, 5, 60) + [(t + 100, v) for t, v in clock(600, 5, 60)]
    games = segments.detect_games(samples, duration=200)
    assert len(games) == 2
    assert games[0]["end_s"] <= 100 <= games[1]["start_s"] + 5


def test_unreadable_gap_is_flagged_but_game_kept():
    samples = [(t, None if 30 <= t < 40 else v) for t, v in clock(600, 5, 100)]
    games = segments.detect_games(samples, duration=300)
    assert len(games) == 1
    assert any("illisible" in d["label"] for d in games[0]["doubts"])


def test_misread_digit_is_ignored():
    samples = clock(600, 5, 60)
    samples[30] = (samples[30][0], 123)
    assert len(segments.detect_games(samples, duration=100)) == 1


def test_video_starting_mid_game_is_flagged():
    samples = [(t, 500 - t) for t in range(0, 60)]
    games = segments.detect_games([(float(t), v) for t, v in samples], duration=100)
    assert games[0]["start_s"] == 0
    assert any("Début estimé" in d["label"] for d in games[0]["doubts"])


def test_noise_without_clock_gives_no_game():
    assert segments.detect_games([(float(t), None) for t in range(100)], duration=100) == []
