import enum
from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, Date, DateTime, Text, Enum
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql.json import JSONB
from sqlalchemy.sql.visitors import iterate
from sqlalchemy.orm import validates

from src.models.models import ValidatedBase, validate_field_helper


class ColorEnum(str, enum.Enum):
    red = "red"
    green = "green"
    blue = "blue"


class TestModel(ValidatedBase):
    __tablename__ = "test_model"

    id = Column(Integer, primary_key=True)
    string_column = Column(String)
    integer_column = Column(Integer)
    boolean_column = Column(Boolean)
    date_column = Column(Date)
    date_time_column = Column(DateTime)
    text_column = Column(Text)
    enum_column = Column(Enum(ColorEnum))
    array_column = Column(postgresql.ARRAY(Integer))
    jsonb_column = Column(JSONB)

    @validates("strindg_column")
    def validate_field(self, field, value):
        return validate_field_helper(
            field, value, "User", getattr(TestModel, field).type
        )


class TestUser(ValidatedBase):
    __tablename__ = "test_users"

    user_id = Column(Integer, nullable=False, primary_key=True)
    name = Column(Text)
    profile_picture = Column(String)
    profile_picture_sizes = Column(String)
    cover_photo = Column(String)
    cover_photo_sizes = Column(String)
    bio = Column(String)
    location = Column(String)


def test_validated_base():
    date_time_column_value = datetime.now()
    date_column_value = date_time_column_value.date()

    my_model = TestModel(
        string_column="some string",
        integer_column=5,
        boolean_column=True,
        date_time_column=date_time_column_value,
        date_column=date_column_value,
        text_column="really long text blah blah blah blah hello world",
        enum_column=ColorEnum.red,
        array_column=[1, 2, 3],
        jsonb_column={"a": 1, "b": 2, "c": 3},
    )

    # print(my_model.validate_string_column)
    print(my_model.__mapper__.validators)
    # print(my_model.validate_field)
    # print(my_model.validate_field.__sa_validators__)
    # print(my_model.validate_integer_column)

    # print(dir(my_model))
    assert my_model.string_column == "some string"
    assert my_model.integer_column == 5
    assert my_model.boolean_column == True
    assert my_model.date_time_column == date_time_column_value
    assert my_model.date_column == date_column_value
    assert my_model.text_column == "really long text blah blah blah blah hello world"
    assert my_model.enum_column == ColorEnum.red
    assert my_model.array_column == [1, 2, 3]
    assert my_model.jsonb_column == {"a": 1, "b": 2, "c": 3}
