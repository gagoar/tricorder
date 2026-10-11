on open location this_URL
	set binPath to (POSIX path of (path to home folder)) & ".claude/tricorder-src/plugin/bin/tricorder"
	if this_URL is "tricorder://warp" then
		-- Script iTerm2 directly (no it2 auth needed): open a tab and fly the ship.
		-- The iTerm2 block is compiled by `run script` when the link is clicked, not when
		-- this app is built: iTerm2's terminology only exists where iTerm2 is installed,
		-- and the app must build on a machine (CI) that does not have it.
		set itermScript to "tell application \"iTerm2\"" & linefeed & ¬
			"activate" & linefeed & ¬
			"if (count of windows) is 0 then" & linefeed & ¬
			"create window with default profile" & linefeed & ¬
			"end if" & linefeed & ¬
			"tell current window" & linefeed & ¬
			"set newTab to (create tab with default profile)" & linefeed & ¬
			"tell current session of newTab to write text " & quote & binPath & " warp" & quote & linefeed & ¬
			"end tell" & linefeed & ¬
			"end tell"
		run script itermScript
	else
		set shPath to (POSIX path of (path to home folder)) & ".claude/tricorder-src/plugin/handler/handle-url.sh"
		do shell script quoted form of shPath & " " & quoted form of this_URL
	end if
end open location
