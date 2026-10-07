from segments import build_segments, clamp_segments

F, T = False, True


def test_single_run():
    flags = [F] * 5 + [T] * 10 + [F] * 5
    assert build_segments(flags, 1.0, min_len_s=5, gap_tolerance_s=2) == [(5.0, 15.0)]


def test_small_gap_is_merged():
    flags = [F] * 5 + [T] * 10 + [F] * 3 + [T] * 10 + [F] * 2
    assert build_segments(flags, 1.0, min_len_s=5, gap_tolerance_s=5) == [(5.0, 28.0)]


def test_large_gap_splits():
    flags = [F] * 5 + [T] * 10 + [F] * 3 + [T] * 10 + [F] * 2
    assert build_segments(flags, 1.0, min_len_s=5, gap_tolerance_s=2) == [(5.0, 15.0), (18.0, 28.0)]


def test_short_run_is_dropped():
    flags = [T] * 3 + [F] * 20 + [T] * 12
    assert build_segments(flags, 1.0, min_len_s=10, gap_tolerance_s=2) == [(23.0, 35.0)]


def test_run_reaching_the_end_is_kept():
    assert build_segments([F, F, T, T, T], 1.0, min_len_s=2, gap_tolerance_s=1) == [(2.0, 5.0)]


def test_step_scales_times():
    flags = [F, T, T, T, F]
    assert build_segments(flags, 2.0, min_len_s=2, gap_tolerance_s=1) == [(2.0, 8.0)]


def test_empty_and_all_false():
    assert build_segments([], 1.0) == []
    assert build_segments([F] * 50, 1.0, min_len_s=1) == []


def test_clamp_segments_borne_la_fin_et_ecarte_les_vides():
    assert clamp_segments([(10.0, 101.0), (100.4, 101.0)], 100.4) == [(10.0, 100.4)]
