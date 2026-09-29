extends Node
## Autoload this script as "PollResults" (Project > Project Settings > Globals > Autoload).
## Polls your Worker for closed poll results and remembers the winners for your scenes.
##
## In a scene:   var cause = PollResults.get_winner("signal_cause", "Creature")
## Or react live: PollResults.poll_result.connect(_on_poll_result)

signal poll_result(result: Dictionary)

@export var base_url := "https://ags-interactive.joshuewok674.workers.dev"   # no trailing slash
@export var api_key := "AGSFunisvilleAnimationGodot2096"                           # your GODOT_KEY secret
@export var poll_interval := 4.0
## If true, results that closed before Godot started are applied too (useful if you restart mid-episode).
@export var apply_history := false

var winners := {}     # key -> winning option (String)
var results := {}     # key -> full result Dictionary
var _last_id := ""
var _first_fetch := true
var _http := HTTPRequest.new()
var _timer := Timer.new()

func _ready() -> void:
	add_child(_http)
	add_child(_timer)
	_http.request_completed.connect(_on_done)
	_timer.wait_time = poll_interval
	_timer.timeout.connect(_poll)
	_timer.start()
	_poll()

func get_winner(key: String, default_value: String = "") -> String:
	## Returns the winner for a poll key, or default_value if it hasn't closed yet or nobody voted.
	return winners.get(key, default_value)

func has_result(key: String) -> bool:
	return winners.has(key)

func _poll() -> void:
	if _http.get_http_client_status() != HTTPClient.STATUS_DISCONNECTED:
		return
	var url := base_url + "/api/results"
	if _last_id != "":
		url += "?after=" + _last_id
	_http.request(url, ["Authorization: Bearer " + api_key])

func _on_done(result: int, code: int, _headers: PackedStringArray, body: PackedByteArray) -> void:
	if result != HTTPRequest.RESULT_SUCCESS or code != 200:
		push_warning("PollResults: request failed (result %d, HTTP %d)" % [result, code])
		return
	var data = JSON.parse_string(body.get_string_from_utf8())
	if typeof(data) != TYPE_DICTIONARY or not data.has("results"):
		return
	for r in data["results"]:
		_last_id = r["pollId"]
		if _first_fetch and not apply_history:
			continue  # baseline only: ignore results from before Godot started
		_apply(r)
	_first_fetch = false

func _apply(r: Dictionary) -> void:
	results[r["key"]] = r
	if r["winner"] != null:            # null = nobody voted, so scenes use their default
		winners[r["key"]] = r["winner"]
	poll_result.emit(r)
