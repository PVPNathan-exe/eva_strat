import names


def line(text, x, y=5, w=100, h=20):
    return {"text": text, "x": x, "y": y, "w": w, "h": h}


def test_normalize_keeps_letters_and_digits_only():
    assert names.normalize("ORxKalime...") == "ORXKALIME"
    assert names.normalize(" NCTx7Takaa , ") == "NCTX7TAKAA"


def test_vote_corrects_a_misread_and_accepts_a_truncated_name():
    assert names.vote(["SHADYJ4Y"] * 6 + ["SHADW4Y"])[0] == "SHADYJ4Y"
    pseudo, share = names.vote(["ORXKALIME", "ORXKALIME", "ORXKAUME"])
    assert pseudo == "ORXKALIME" and share == 1.0
    assert names.vote(["12", "?"]) == (None, 0.0)  # moins de 3 lettres : rien de lisible


def test_lines_are_attached_to_the_banner_they_sit_on():
    lines = [line("NCTXSPIRIT", 160), line("SHADYJ4Y", 10), line("NCTXVEX", 470)]  # largeur 640 : 4 bandeaux de 160 px
    assert names.assign_lines(lines, 640) == {0: "SHADYJ4Y", 1: "NCTXSPIRIT", 3: "NCTXVEX"}  # le bandeau 3 (indice 2) est resté illisible


def test_closest_finds_the_player_from_a_noisy_or_truncated_text():
    team = {1: "SHADYJ4Y", 2: "NCTXSPIRIT", 3: "NCTX7TAKAA", 4: "NCTXVEX", 5: "ORXPAPY", 6: "ORXBENOU", 7: "ORXKALIME", 8: "ORXPHYSIO"}
    assert names.closest("ORHPAPY", team) == 5
    assert names.closest("nCTHSp,it", team, "A") == 2
    assert names.closest("ORXKALI", team) == 7
    assert names.closest("ORXKALIMERO", team) == 7
    assert names.closest("TOTALEMENTAUTRE", team) is None
    assert names.closest("NCTX", team, "A") is None  # trop court / ambigu entre trois joueurs


def test_frequent_letter_confusions_still_find_the_player():
    team = {1: "SHADYJ4Y", 2: "NCTXSPIRIT", 3: "NCTX7TAKAA", 4: "NCTXVEX", 5: "ORXPAPY", 6: "ORXBENOU", 7: "ORXKALIME", 8: "ORXPHYSIO"}
    assert names.closest("nCTHUEH", team, "A") == 4  # NCTxVEX lu « nCTHUEH »
    assert names.closest("ShadvJUv", team, "A") == 1
    assert names.closest("NCTHUEH", team, "B") is None  # la bonne équipe est exigée
