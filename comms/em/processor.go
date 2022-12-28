package em

import (
	"comms.audius.co/config"
	"comms.audius.co/db"
)

func processEntityManagerAction(action *EntityManagerAction) {
	logger := config.Logger.New("user_id", action.UserID, "action", action.Action+action.EntityType, "entity_id", action.EntityID)

	tx, err := db.Conn.Begin()
	if err != nil {
		panic(err)
	}
	defer tx.Rollback()

	fqmethod := action.Action + action.EntityType

	switch fqmethod {
	// case "UpdateUser":
	// case "CreateTrack", "UpdateTrack":
	default:
		logger.Info("no handler for: " + fqmethod)
	}

	err = tx.Rollback()
	if err != nil {
		panic(err)
	}

}
